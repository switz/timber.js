// Response compression for self-hosted deployments (dev server, Nitro preview).
//
// Uses CompressionStream (Web Platform API) for gzip. Brotli is intentionally
// left to CDNs and reverse proxies — at streaming-friendly quality levels its
// ratio advantage is marginal, and node:zlib's brotli transform buffers output
// internally, breaking streaming. Cloudflare Workers auto-compress at the edge —
// this module is only used on Node.js/Bun.
//
// See design/25-production-deployments.md.

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
 * Returns 'gzip' if the client accepts it, null otherwise.
 *
 * Brotli (br) is intentionally not handled at the application level.
 * At the streaming-friendly quality levels (0–4), brotli's compression
 * ratio advantage over gzip is marginal, and node:zlib's brotli transform
 * buffers output internally — turning smooth streaming responses into
 * large infrequent bursts. Brotli's real wins come from offline/static
 * compression at higher quality levels (5–11), which CDNs and reverse
 * proxies (Cloudflare, nginx, Caddy) apply on cached responses.
 *
 * See design/25-production-deployments.md.
 */
export function negotiateEncoding(acceptEncoding: string): 'gzip' | null {
  if (!acceptEncoding) return null;

  // Parse tokens from the Accept-Encoding header (ignore quality values).
  // e.g. "gzip;q=1.0, br;q=0.8, deflate" → ['gzip', 'br', 'deflate']
  const tokens = acceptEncoding.split(',').map((s) => s.split(';')[0].trim().toLowerCase());

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

  // Compress the body stream with gzip via the Web Platform CompressionStream API.
  const compressedBody = compressWithGzip(response.body!);

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

