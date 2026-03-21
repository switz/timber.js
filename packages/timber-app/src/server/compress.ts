// Response compression for self-hosted deployments (dev server, Nitro preview).
//
// Uses CompressionStream (Web Platform API) for gzip and node:zlib for
// brotli (CompressionStream doesn't support brotli). Cloudflare Workers
// auto-compress at the edge — this module is only used on Node.js/Bun.
//
// See design/25-production-deployments.md.

import { createBrotliCompress, constants as zlibConstants } from 'node:zlib';
import { Readable } from 'node:stream';

// ─── Constants ────────────────────────────────────────────────────────────

/**
 * MIME types that benefit from compression.
 * text/* is handled via prefix matching; these are the specific
 * application/* and image/* types that are compressible.
 */
export const COMPRESSIBLE_TYPES = new Set([
  'text/html',
  'text/css',
  'text/plain',
  'text/xml',
  'text/javascript',
  'text/x-component',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/xhtml+xml',
  'application/rss+xml',
  'application/atom+xml',
  'image/svg+xml',
]);

/**
 * Status codes that should never be compressed (no body or special semantics).
 */
const NO_COMPRESS_STATUSES = new Set([204, 304]);

// ─── Encoding Negotiation ─────────────────────────────────────────────────

/**
 * Parse Accept-Encoding and return the best supported encoding.
 * Prefers brotli (br) over gzip. Returns null if no supported encoding.
 *
 * We always prefer brotli regardless of quality values because:
 * 1. Brotli achieves better compression ratios than gzip
 * 2. All modern browsers that send br in Accept-Encoding support it well
 * 3. Respecting q-values for br vs gzip adds complexity with no real benefit
 */
export function negotiateEncoding(acceptEncoding: string): 'br' | 'gzip' | null {
  if (!acceptEncoding) return null;

  // Parse tokens from the Accept-Encoding header (ignore quality values).
  // e.g. "gzip;q=1.0, br;q=0.8, deflate" → ['gzip', 'br', 'deflate']
  const tokens = acceptEncoding.split(',').map((s) => s.split(';')[0].trim().toLowerCase());

  if (tokens.includes('br')) return 'br';
  if (tokens.includes('gzip')) return 'gzip';
  return null;
}

// ─── Compressibility Check ────────────────────────────────────────────────

/**
 * Determine if a response should be compressed.
 *
 * Returns false for:
 * - Responses without a body (204, 304, null body)
 * - Already-encoded responses (Content-Encoding set)
 * - Non-compressible content types (images, binary)
 * - SSE streams (text/event-stream — must not be buffered)
 */
export function shouldCompress(response: Response): boolean {
  // No body to compress
  if (!response.body) return false;
  if (NO_COMPRESS_STATUSES.has(response.status)) return false;

  // Already compressed
  if (response.headers.has('Content-Encoding')) return false;

  // Check content type
  const contentType = response.headers.get('Content-Type');
  if (!contentType) return false;

  // Extract the MIME type (strip charset and other parameters)
  const mimeType = contentType.split(';')[0].trim().toLowerCase();

  // SSE must not be compressed — it relies on chunk-by-chunk delivery
  if (mimeType === 'text/event-stream') return false;

  return COMPRESSIBLE_TYPES.has(mimeType);
}

// ─── Compression ──────────────────────────────────────────────────────────

/**
 * Compress a Web Response if the client supports it and the content is compressible.
 *
 * Returns the original response unchanged if compression is not applicable.
 * Returns a new Response with the compressed body, Content-Encoding, and Vary headers.
 *
 * The body is piped through a compression stream — no buffering of the full response.
 * This preserves streaming behavior for HTML shell + deferred Suspense chunks.
 */
export function compressResponse(request: Request, response: Response): Response {
  // Check if response is compressible
  if (!shouldCompress(response)) return response;

  // Negotiate encoding with the client
  const acceptEncoding = request.headers.get('Accept-Encoding') ?? '';
  const encoding = negotiateEncoding(acceptEncoding);
  if (!encoding) return response;

  // Compress the body stream
  const compressedBody = encoding === 'br'
    ? compressWithBrotli(response.body!)
    : compressWithGzip(response.body!);

  // Build new headers: copy originals, add compression headers, remove Content-Length
  // (compressed size is unknown until streaming completes).
  const headers = new Headers(response.headers);
  headers.set('Content-Encoding', encoding);
  headers.delete('Content-Length');

  // Append to Vary header (preserve existing Vary values)
  const existingVary = headers.get('Vary');
  if (existingVary) {
    if (!existingVary.toLowerCase().includes('accept-encoding')) {
      headers.set('Vary', `${existingVary}, Accept-Encoding`);
    }
  } else {
    headers.set('Vary', 'Accept-Encoding');
  }

  return new Response(compressedBody, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ─── Gzip (CompressionStream API) ────────────────────────────────────────

/**
 * Compress a ReadableStream with gzip using the Web Platform CompressionStream API.
 * Available in Node 18+, Bun, and Deno — no npm dependency needed.
 */
function compressWithGzip(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const compressionStream = new CompressionStream('gzip');
  // Cast needed: CompressionStream's WritableStream<BufferSource> type is wider
  // than ReadableStream's Uint8Array, but Uint8Array is a valid BufferSource.
  return body.pipeThrough(compressionStream as unknown as TransformStream<Uint8Array, Uint8Array>);
}

// ─── Brotli (node:zlib) ──────────────────────────────────────────────────

/**
 * Compress a ReadableStream with brotli using node:zlib.
 *
 * CompressionStream doesn't support brotli — it only handles gzip and deflate.
 * We use node:zlib's createBrotliCompress() and bridge between Web streams
 * and Node streams.
 */
function compressWithBrotli(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const brotli = createBrotliCompress({
    params: {
      // Quality 4 balances compression ratio and CPU time for streaming.
      // Default (11) is too slow for real-time responses.
      [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
    },
  });

  // Pipe the Web ReadableStream into the Node brotli transform.
  const reader = body.getReader();

  // Pump chunks from the Web ReadableStream into the Node transform.
  const pump = async (): Promise<void> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          brotli.end();
          return;
        }
        // Write to brotli, wait for drain if buffer is full
        if (!brotli.write(value)) {
          await new Promise<void>((resolve) => brotli.once('drain', resolve));
        }
      }
    } catch (err) {
      brotli.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  };
  // Start pumping (fire and forget — errors propagate via brotli stream)
  pump();

  // Convert the Node readable (brotli output) to a Web ReadableStream.
  return Readable.toWeb(brotli) as ReadableStream<Uint8Array>;
}
