// Node.js HTTP server adapter
//
// Self-hosting, Docker, and any Node.js-based platform. Wraps the timber
// request handler in a `node:http` server with gzip/brotli compression.
// See design/11-platform.md §"Node.js".

import { writeFile, mkdir, cp } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import type { TimberPlatformAdapter, TimberConfig } from './types';

// Minimum response size (bytes) before compression is applied.
// Responses smaller than this are sent uncompressed to avoid overhead.
const COMPRESS_THRESHOLD = 512;

/** Options for the Node.js adapter. */
export interface NodeAdapterOptions {
  /**
   * Hostname to bind the HTTP server to.
   * @default '0.0.0.0'
   */
  hostname?: string;

  /**
   * Port to listen on.
   * @default 3000
   */
  port?: number;

  /**
   * Enable gzip/brotli compression for responses.
   * @default true
   */
  compress?: boolean;
}

/**
 * Create a Node.js HTTP server adapter.
 *
 * @example
 * ```ts
 * import { node } from '@timber/app/adapters/node'
 *
 * export default {
 *   output: 'server',
 *   adapter: node({ port: 3000 }),
 * }
 * ```
 */
export function node(options: NodeAdapterOptions = {}): TimberPlatformAdapter {
  const pendingPromises: Promise<unknown>[] = [];

  return {
    name: 'node',

    async buildOutput(config: TimberConfig, buildDir: string) {
      const outDir = join(buildDir, 'node');
      await mkdir(outDir, { recursive: true });

      // Copy client assets to public directory for static serving
      const clientDir = join(buildDir, 'client');
      const publicDir = join(outDir, 'public');
      await mkdir(publicDir, { recursive: true });
      await cp(clientDir, publicDir, { recursive: true }).catch(() => {
        // Client dir may not exist in static+noJS mode
      });

      // Generate the Node.js entry point
      const entry = generateNodeEntry(buildDir, outDir);
      await writeFile(join(outDir, 'entry.mjs'), entry);
    },

    async preview(config: TimberConfig, buildDir: string) {
      const { createServer } = await import('node:http');
      const { handler } = await import(join(buildDir, 'node', 'entry.mjs'));

      const hostname = options.hostname ?? '0.0.0.0';
      const port = options.port ?? 3000;

      const server = createServer(async (req, res) => {
        const { requestHandler } = createNodeHandler(this, handler, {
          compress: options.compress ?? true,
        });
        await requestHandler(req, res);
      });

      return new Promise<void>((resolve) => {
        server.listen(port, hostname, () => {
          console.log(`[timber] Node.js server listening on http://${hostname}:${port}`);
          resolve();
        });
      });
    },

    waitUntil(promise: Promise<unknown>) {
      const tracked = promise.catch((err) => {
        console.error('[timber] waitUntil promise rejected:', err);
      });
      pendingPromises.push(tracked);
    },
  };
}

// ─── Request Handler ─────────────────────────────────────────────────────────

/** Minimal subset of node:http IncomingMessage used by the adapter. */
export interface NodeRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): void;
}

/** Minimal subset of node:http ServerResponse used by the adapter. */
export interface NodeResponse {
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: Buffer | string): boolean;
  end(data?: string | Buffer): void;
}

interface NodeHandlerOptions {
  compress?: boolean;
}

/**
 * Create a Node.js HTTP request handler that bridges node:http to web
 * Request/Response. Returns the request handler and a function to wait
 * for all pending waitUntil promises.
 *
 * @internal Exported for testing.
 */
export function createNodeHandler(
  adapter: TimberPlatformAdapter,
  handler: (req: Request) => Promise<Response>,
  options: NodeHandlerOptions = {}
) {
  const pendingPromises: Promise<unknown>[] = [];
  const compress = options.compress ?? false;

  // Override adapter.waitUntil to collect promises
  const originalWaitUntil = adapter.waitUntil;
  adapter.waitUntil = (promise: Promise<unknown>) => {
    const tracked = promise.catch((err) => {
      console.error('[timber] waitUntil promise rejected:', err);
    });
    pendingPromises.push(tracked);

    // Also forward to the adapter's own collector
    originalWaitUntil?.call(adapter, promise);
  };

  async function requestHandler(req: NodeRequest, res: NodeResponse): Promise<void> {
    try {
      const webRequest = nodeToWebRequest(req);
      const webResponse = await handler(webRequest);
      await writeWebResponse(webResponse, req, res, compress);
    } catch (err) {
      console.error('[timber] Unhandled error in request handler:', err);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  async function waitForPending(): Promise<void> {
    await Promise.allSettled(pendingPromises);
    pendingPromises.length = 0;
  }

  return { requestHandler, waitForPending };
}

// ─── Web ↔ Node Bridges ──────────────────────────────────────────────────────

/** Convert a Node.js IncomingMessage to a web Request. */
function nodeToWebRequest(req: NodeRequest): Request {
  const method = req.method ?? 'GET';
  const host = req.headers['host'] ?? 'localhost';
  const protocol = 'http';
  const url = `${protocol}://${host}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? nodeRequestBody(req) : undefined;

  return new Request(url, {
    method,
    headers,
    body,
    // @ts-expect-error -- Node.js supports duplex on Request
    duplex: hasBody ? 'half' : undefined,
  });
}

/** Create a ReadableStream from a Node.js IncomingMessage body. */
function nodeRequestBody(req: NodeRequest): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      req.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      req.on('end', () => {
        controller.close();
      });
      req.on('error', (err: Error) => {
        controller.error(err);
      });
    },
  });
}

/** Write a web Response to a Node.js ServerResponse. */
async function writeWebResponse(
  webResponse: Response,
  req: NodeRequest,
  res: NodeResponse,
  compress: boolean
): Promise<void> {
  const headers: Record<string, string> = {};
  webResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const body = webResponse.body;

  // For non-streaming responses, read full body for potential compression
  if (body === null) {
    res.writeHead(webResponse.status, headers);
    res.end();
    return;
  }

  // Read the full body (needed for compression check + non-streaming path)
  const bodyBytes = await readAllBytes(body);
  const bodyText = new TextDecoder().decode(bodyBytes);

  // Apply compression if appropriate
  const encoding = compress ? selectEncoding(req, headers, bodyBytes.byteLength) : null;

  if (encoding) {
    const compressed = compressBody(bodyBytes, encoding);
    headers['content-encoding'] = encoding;
    // Remove content-length since compressed size differs
    delete headers['content-length'];
    res.writeHead(webResponse.status, headers);
    res.end(Buffer.from(compressed));
  } else {
    res.writeHead(webResponse.status, headers);
    res.end(bodyText);
  }
}

// ─── Compression ─────────────────────────────────────────────────────────────

/** Pick the best encoding from Accept-Encoding, or null if none. */
function selectEncoding(
  req: NodeRequest,
  headers: Record<string, string>,
  bodyLength: number
): 'br' | 'gzip' | null {
  // Don't compress tiny responses
  if (bodyLength < COMPRESS_THRESHOLD) return null;

  // Don't re-compress already encoded responses
  if (headers['content-encoding']) return null;

  const accept = req.headers['accept-encoding'];
  const acceptStr = Array.isArray(accept) ? accept.join(', ') : (accept ?? '');

  // Prefer brotli over gzip
  if (acceptStr.includes('br')) return 'br';
  if (acceptStr.includes('gzip')) return 'gzip';

  return null;
}

/** Compress a body buffer with the given encoding. */
function compressBody(body: Uint8Array, encoding: 'br' | 'gzip'): Buffer {
  if (encoding === 'br') {
    return brotliCompressSync(body);
  }
  return gzipSync(body);
}

/** Read all bytes from a ReadableStream. */
async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

// ─── Entry Generation ────────────────────────────────────────────────────────

/** @internal Exported for testing. */
export function generateNodeEntry(buildDir: string, outDir: string): string {
  const serverEntryRelative = relative(outDir, join(buildDir, 'server', 'entry.js'));

  return `// Generated by @timber/app/adapters/node
// Do not edit — this file is regenerated on each build.

import { createServer } from 'node:http'
import { createNodeHandler } from '@timber/app/adapters/node'
import { handler, adapter } from '${serverEntryRelative}'

const compress = true
const port = parseInt(process.env.PORT || '3000', 10)
const hostname = process.env.HOST || '0.0.0.0'

const { requestHandler, waitForPending } = createNodeHandler(adapter, handler, { compress })

const server = createServer(async (req, res) => {
  await requestHandler(req, res)
})

// Serve static files from public/
const publicDir = new URL('./public/', import.meta.url).pathname

server.listen(port, hostname, () => {
  console.log(\`[timber] Node.js server listening on http://\${hostname}:\${port}\`)
})

// Graceful shutdown: wait for pending waitUntil promises
process.on('SIGTERM', async () => {
  server.close()
  await waitForPending()
  process.exit(0)
})
`;
}
