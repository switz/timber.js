/**
 * Tests for response compression (gzip/brotli).
 *
 * Validates the compressResponse helper used by the dev server and
 * Nitro preview server. See design/25-production-deployments.md.
 */

import { describe, it, expect } from 'vitest';
import { createBrotliDecompress, createGunzip } from 'node:zlib';
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

/** Decompress a brotli buffer. */
async function decompressBrotli(buf: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const br = createBrotliDecompress();
  const input = Readable.from(buf);
  br.on('data', (chunk: Buffer) => chunks.push(chunk));
  await pipeline(input, br);
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
  it('prefers brotli when client accepts br', () => {
    expect(negotiateEncoding('br, gzip, deflate')).toBe('br');
  });

  it('falls back to gzip when br is not accepted', () => {
    expect(negotiateEncoding('gzip, deflate')).toBe('gzip');
  });

  it('returns null when no supported encoding is accepted', () => {
    expect(negotiateEncoding('deflate')).toBeNull();
    expect(negotiateEncoding('')).toBeNull();
  });

  it('handles Accept-Encoding with quality values', () => {
    expect(negotiateEncoding('gzip;q=1.0, br;q=0.8')).toBe('br');
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

  it('compresses HTML with brotli when client accepts br', async () => {
    const body = '<html><body>Hello, World!</body></html>';
    const req = requestWith('br, gzip');
    const res = textResponse(body);

    const compressed = compressResponse(req, res);
    expect(compressed.headers.get('Content-Encoding')).toBe('br');

    const buf = await streamToBuffer(compressed.body!);
    const decompressed = await decompressBrotli(buf);
    expect(decompressed.toString()).toBe(body);
  });

  it('returns original response when client does not accept compression', () => {
    const req = requestWith('identity');
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
