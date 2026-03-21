/**
 * Tests for response compression (gzip/brotli).
 *
 * Validates the compressResponse helper used by the dev server and
 * Nitro preview server. See design/25-production-deployments.md.
 */

import { describe, it, expect } from 'vitest';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  compressResponse,
  shouldCompress,
  negotiateEncoding,
  COMPRESSIBLE_TYPES,
} from '#/server/compress.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Collect a ReadableStream into a Buffer. */
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Decompress a gzip buffer. */
async function decompressGzip(buf: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const gunzip = createGunzip();
  const input = Readable.from(buf);
  gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
  await pipeline(input, gunzip);
  return Buffer.concat(chunks);
}

/** Create a simple Response with text body and content-type. */
function textResponse(body: string, contentType = 'text/html', headers?: Record<string, string>): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentType, ...headers },
  });
}

/** Create a Request with Accept-Encoding. */
function requestWith(acceptEncoding: string): Request {
  return new Request('http://localhost/', {
    headers: { 'Accept-Encoding': acceptEncoding },
  });
}

// ─── negotiateEncoding ───────────────────────────────────────────────────

describe('negotiateEncoding', () => {
  it('returns gzip when client accepts gzip', () => {
    expect(negotiateEncoding('gzip, deflate')).toBe('gzip');
  });

  it('returns gzip even when client also accepts br (brotli left to CDN)', () => {
    // Brotli is intentionally not handled at the application level.
    // CDNs/reverse proxies apply brotli on cached responses at higher quality levels.
    expect(negotiateEncoding('br, gzip, deflate')).toBe('gzip');
  });

  it('returns null when no supported encoding is accepted', () => {
    expect(negotiateEncoding('deflate')).toBeNull();
    expect(negotiateEncoding('')).toBeNull();
  });

  it('returns null for br-only (brotli not handled at app level)', () => {
    expect(negotiateEncoding('br')).toBeNull();
  });

  it('handles Accept-Encoding with quality values', () => {
    expect(negotiateEncoding('gzip;q=1.0, br;q=0.8')).toBe('gzip');
  });

  it('returns null when gzip is explicitly disabled with q=0', () => {
    expect(negotiateEncoding('gzip;q=0')).toBeNull();
  });

  it('returns null when gzip q=0 even with other encodings present', () => {
    expect(negotiateEncoding('br;q=1, gzip;q=0')).toBeNull();
  });

  it('returns null when gzip q=0 and deflate present', () => {
    expect(negotiateEncoding('gzip;q=0, deflate')).toBeNull();
  });

  it('returns gzip when q > 0', () => {
    expect(negotiateEncoding('gzip;q=0.5')).toBe('gzip');
    expect(negotiateEncoding('gzip;q=0.001')).toBe('gzip');
  });

  it('returns gzip when q=1 explicitly', () => {
    expect(negotiateEncoding('br;q=0, gzip;q=1')).toBe('gzip');
  });

  it('returns null for identity-only', () => {
    expect(negotiateEncoding('identity')).toBeNull();
  });
});

// ─── shouldCompress ──────────────────────────────────────────────────────

describe('shouldCompress', () => {
  it('returns true for text/html', () => {
    expect(shouldCompress(textResponse('hello', 'text/html'))).toBe(true);
  });

  it('returns true for application/json', () => {
    expect(shouldCompress(textResponse('{}', 'application/json'))).toBe(true);
  });

  it('returns true for application/javascript', () => {
    expect(shouldCompress(textResponse('var x', 'application/javascript'))).toBe(true);
  });

  it('returns true for text/x-component (RSC payload)', () => {
    expect(shouldCompress(textResponse('rsc', 'text/x-component'))).toBe(true);
  });

  it('returns true for text/css', () => {
    expect(shouldCompress(textResponse('body{}', 'text/css'))).toBe(true);
  });

  it('returns false for image/png', () => {
    expect(shouldCompress(textResponse('binary', 'image/png'))).toBe(false);
  });

  it('returns false for application/octet-stream', () => {
    expect(shouldCompress(textResponse('binary', 'application/octet-stream'))).toBe(false);
  });

  it('returns false when Content-Encoding is already set', () => {
    const res = textResponse('hello', 'text/html', { 'Content-Encoding': 'gzip' });
    expect(shouldCompress(res)).toBe(false);
  });

  it('returns false for text/event-stream (SSE)', () => {
    expect(shouldCompress(textResponse('data: hi\n\n', 'text/event-stream'))).toBe(false);
  });

  it('returns false for 204 No Content', () => {
    const res = new Response(null, { status: 204 });
    expect(shouldCompress(res)).toBe(false);
  });

  it('returns false for 304 Not Modified', () => {
    const res = new Response(null, { status: 304 });
    expect(shouldCompress(res)).toBe(false);
  });

  it('returns false when no body', () => {
    const res = new Response(null, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    expect(shouldCompress(res)).toBe(false);
  });

  it('returns true for content-type with charset parameter', () => {
    expect(shouldCompress(textResponse('hello', 'text/html; charset=utf-8'))).toBe(true);
  });
});

// ─── compressResponse ────────────────────────────────────────────────────

describe('compressResponse', () => {
  it('compresses HTML with gzip when client accepts gzip', async () => {
    const body = '<html><body>Hello, World!</body></html>';
    const req = requestWith('gzip');
    const res = textResponse(body);

    const compressed = compressResponse(req, res);
    expect(compressed).not.toBe(res); // new response returned

    expect(compressed.headers.get('Content-Encoding')).toBe('gzip');
    expect(compressed.headers.get('Vary')).toContain('Accept-Encoding');
    // Content-Length should be removed since we're streaming compression
    expect(compressed.headers.has('Content-Length')).toBe(false);

    const buf = await streamToBuffer(compressed.body!);
    const decompressed = await decompressGzip(buf);
    expect(decompressed.toString()).toBe(body);
  });

  it('uses gzip (not brotli) when client accepts both br and gzip', async () => {
    // Brotli is left to CDNs — app-level compression only does gzip.
    const body = '<html><body>Hello, World!</body></html>';
    const req = requestWith('br, gzip');
    const res = textResponse(body);

    const compressed = compressResponse(req, res);
    expect(compressed.headers.get('Content-Encoding')).toBe('gzip');

    const buf = await streamToBuffer(compressed.body!);
    const decompressed = await decompressGzip(buf);
    expect(decompressed.toString()).toBe(body);
  });

  it('returns original response when client only accepts br', () => {
    const req = requestWith('br');
    const res = textResponse('hello');

    const result = compressResponse(req, res);
    expect(result).toBe(res); // no compression — brotli not handled at app level
  });

  it('returns original response when client does not accept compression', () => {
    const req = requestWith('identity');
    const res = textResponse('hello');

    const result = compressResponse(req, res);
    expect(result).toBe(res);
  });

  it('returns original response when gzip is disabled with q=0', () => {
    const req = requestWith('gzip;q=0, br;q=1');
    const res = textResponse('hello');

    const result = compressResponse(req, res);
    expect(result).toBe(res);
  });

  it('returns original response for non-compressible content type', () => {
    const req = requestWith('gzip, br');
    const res = textResponse('binary', 'image/png');

    const result = compressResponse(req, res);
    expect(result).toBe(res);
  });

  it('returns original response when Content-Encoding is already set', () => {
    const req = requestWith('gzip, br');
    const res = textResponse('hello', 'text/html', { 'Content-Encoding': 'gzip' });

    const result = compressResponse(req, res);
    expect(result).toBe(res);
  });

  it('returns original response for SSE', () => {
    const req = requestWith('gzip, br');
    const res = textResponse('data: hi\n\n', 'text/event-stream');

    const result = compressResponse(req, res);
    expect(result).toBe(res);
  });

  it('preserves status code and other headers', async () => {
    const req = requestWith('gzip');
    const res = new Response('custom', {
      status: 201,
      headers: {
        'Content-Type': 'text/plain',
        'X-Custom': 'test',
      },
    });

    const compressed = compressResponse(req, res);
    expect(compressed.status).toBe(201);
    expect(compressed.headers.get('X-Custom')).toBe('test');
    expect(compressed.headers.get('Content-Encoding')).toBe('gzip');
  });

  it('compresses RSC text/x-component payloads', async () => {
    const body = '0:["$","div",null,{"children":"Hello"}]\n';
    const req = requestWith('gzip');
    const res = textResponse(body, 'text/x-component');

    const compressed = compressResponse(req, res);
    expect(compressed.headers.get('Content-Encoding')).toBe('gzip');

    const buf = await streamToBuffer(compressed.body!);
    const decompressed = await decompressGzip(buf);
    expect(decompressed.toString()).toBe(body);
  });

  it('handles streaming bodies correctly', async () => {
    const chunks = ['chunk1', 'chunk2', 'chunk3'];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const req = requestWith('gzip');
    const res = new Response(stream, {
      headers: { 'Content-Type': 'text/html' },
    });

    const compressed = compressResponse(req, res);
    const buf = await streamToBuffer(compressed.body!);
    const decompressed = await decompressGzip(buf);
    expect(decompressed.toString()).toBe('chunk1chunk2chunk3');
  });

  it('returns original for 204 status', () => {
    const req = requestWith('gzip');
    const res = new Response(null, { status: 204 });

    const result = compressResponse(req, res);
    expect(result).toBe(res);
  });

  it('streams gzip output as chunks arrive (not buffered into one burst)', async () => {
    // Simulate a streaming response with delayed chunks (like SSR with Suspense).
    // Verify that compressed output is emitted per-chunk, not buffered.
    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Write chunks with small delays to simulate streaming
    const writeChunks = async () => {
      await writer.write(encoder.encode('<html><body>'));
      await new Promise((r) => setTimeout(r, 10));
      await writer.write(encoder.encode('<div>chunk1</div>'));
      await new Promise((r) => setTimeout(r, 10));
      await writer.write(encoder.encode('<div>chunk2</div>'));
      await new Promise((r) => setTimeout(r, 10));
      await writer.write(encoder.encode('</body></html>'));
      await writer.close();
    };
    writeChunks(); // fire and forget

    const req = requestWith('gzip');
    const res = new Response(readable, {
      headers: { 'Content-Type': 'text/html' },
    });

    const compressed = compressResponse(req, res);
    expect(compressed.headers.get('Content-Encoding')).toBe('gzip');

    // Read compressed output and verify we get multiple chunks
    // (not one big buffer at the end)
    const reader = compressed.body!.getReader();
    const outputChunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      outputChunks.push(value);
    }

    // CompressionStream('gzip') flushes per transform call, so we expect
    // multiple output chunks for multiple input chunks
    expect(outputChunks.length).toBeGreaterThan(1);

    // Verify the decompressed content is correct
    const fullBuf = Buffer.concat(outputChunks);
    const decompressed = await decompressGzip(fullBuf);
    expect(decompressed.toString()).toBe(
      '<html><body><div>chunk1</div><div>chunk2</div></body></html>',
    );
  });
});

// ─── COMPRESSIBLE_TYPES ──────────────────────────────────────────────────

describe('COMPRESSIBLE_TYPES', () => {
  it('includes expected MIME types', () => {
    const expected = [
      'text/html',
      'text/css',
      'text/plain',
      'text/xml',
      'text/x-component',
      'application/json',
      'application/javascript',
      'application/xml',
      'application/xhtml+xml',
      'image/svg+xml',
    ];
    for (const type of expected) {
      expect(COMPRESSIBLE_TYPES.has(type)).toBe(true);
    }
  });
});
