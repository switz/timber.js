import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TimberPlatformAdapter } from '../../packages/timber-app/src/adapters/types';

// Mock node:fs/promises at the module level for ESM compatibility
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
}));

import { writeFile, mkdir, cp } from 'node:fs/promises';
import {
  node,
  createNodeHandler,
  generateNodeEntry,
  type NodeRequest,
  type NodeResponse,
} from '../../packages/timber-app/src/adapters/node';

const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockCp = vi.mocked(cp);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Node adapter interface', () => {
  it('has name "node"', () => {
    const adapter = node();
    expect(adapter.name).toBe('node');
  });

  it('satisfies TimberPlatformAdapter', () => {
    const adapter: TimberPlatformAdapter = node();
    expect(adapter.name).toBe('node');
    expect(typeof adapter.buildOutput).toBe('function');
  });

  it('provides waitUntil method', () => {
    const adapter = node();
    expect(typeof adapter.waitUntil).toBe('function');
  });

  it('provides preview method', () => {
    const adapter = node();
    expect(typeof adapter.preview).toBe('function');
  });
});

describe('buildOutput', () => {
  it('creates output directory', async () => {
    const adapter = node();
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('node'), {
      recursive: true,
    });
  });

  it('copies client assets to public directory', async () => {
    const adapter = node();
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    expect(mockCp).toHaveBeenCalledWith(
      expect.stringContaining('client'),
      expect.stringContaining('public'),
      { recursive: true }
    );
  });

  it('writes server entry file', async () => {
    const adapter = node();
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    const entryCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('entry.mjs')
    );
    expect(entryCall).toBeDefined();
  });

  it('does not fail when client dir is missing (static+noJS)', async () => {
    mockCp.mockRejectedValueOnce(new Error('ENOENT'));
    const adapter = node();

    await expect(
      adapter.buildOutput({ output: 'static', static: { noJS: true } }, '/tmp/build')
    ).resolves.not.toThrow();
  });
});

describe('generateNodeEntry', () => {
  it('generates entry importing from server entry', () => {
    const entry = generateNodeEntry('/tmp/build', '/tmp/build/node');
    expect(entry).toContain('server/entry.js');
    expect(entry).toContain('node:http');
  });

  it('includes compression middleware', () => {
    const entry = generateNodeEntry('/tmp/build', '/tmp/build/node');
    expect(entry).toContain('compress');
  });

  it('references the static file directory', () => {
    const entry = generateNodeEntry('/tmp/build', '/tmp/build/node');
    expect(entry).toContain('public');
  });
});

describe('http serve', () => {
  it('createNodeHandler converts node IncomingMessage to web Request', async () => {
    const timberHandler = vi.fn().mockResolvedValue(new Response('hello world'));
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler);

    // Simulate a minimal Node.js IncomingMessage + ServerResponse
    const req = createMockIncomingMessage('GET', '/test', {
      host: 'localhost:3000',
    });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    expect(timberHandler).toHaveBeenCalledTimes(1);
    const webReq = timberHandler.mock.calls[0][0] as Request;
    expect(webReq.method).toBe('GET');
    expect(new URL(webReq.url).pathname).toBe('/test');

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith('hello world');
  });

  it('streams response body for ReadableStream responses', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk1'));
        controller.enqueue(new TextEncoder().encode('chunk2'));
        controller.close();
      },
    });
    const timberHandler = vi.fn().mockResolvedValue(new Response(body));
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler);

    const req = createMockIncomingMessage('GET', '/', { host: 'localhost' });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    // For streaming, write is called for each chunk
    const written = res._written.join('');
    expect(written).toContain('chunk1');
    expect(written).toContain('chunk2');
  });

  it('forwards response status and headers', async () => {
    const timberHandler = vi.fn().mockResolvedValue(
      new Response('not found', {
        status: 404,
        headers: { 'X-Custom': 'test', 'Content-Type': 'text/plain' },
      })
    );
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler);

    const req = createMockIncomingMessage('GET', '/missing', { host: 'localhost' });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      404,
      expect.objectContaining({
        'x-custom': 'test',
        'content-type': 'text/plain',
      })
    );
  });

  it('handles POST with body', async () => {
    const timberHandler = vi.fn().mockResolvedValue(new Response('ok'));
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler);

    const req = createMockIncomingMessage('POST', '/submit', {
      'host': 'localhost',
      'content-type': 'application/json',
    });
    const res = createMockServerResponse();

    // Simulate body chunks
    setTimeout(() => {
      req.emit('data', Buffer.from('{"name":"test"}'));
      req.emit('end');
    }, 0);

    await requestHandler(req, res);

    const webReq = timberHandler.mock.calls[0][0] as Request;
    expect(webReq.method).toBe('POST');
  });

  it('returns 500 if handler throws', async () => {
    const timberHandler = vi.fn().mockRejectedValue(new Error('boom'));
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler);

    const req = createMockIncomingMessage('GET', '/', { host: 'localhost' });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
  });
});

describe('compression', () => {
  it('compresses response with gzip when Accept-Encoding includes gzip', async () => {
    const largeBody = 'a'.repeat(1024);
    const timberHandler = vi.fn().mockResolvedValue(
      new Response(largeBody, {
        headers: { 'Content-Type': 'text/html' },
      })
    );
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler, {
      compress: true,
    });

    const req = createMockIncomingMessage('GET', '/', {
      'host': 'localhost',
      'accept-encoding': 'gzip, deflate',
    });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    // Should set content-encoding header
    const headers = res.writeHead.mock.calls[0][1] as Record<string, string>;
    expect(headers['content-encoding']).toBe('gzip');
  });

  it('compresses response with brotli when preferred', async () => {
    const largeBody = 'a'.repeat(1024);
    const timberHandler = vi.fn().mockResolvedValue(
      new Response(largeBody, {
        headers: { 'Content-Type': 'text/html' },
      })
    );
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler, {
      compress: true,
    });

    const req = createMockIncomingMessage('GET', '/', {
      'host': 'localhost',
      'accept-encoding': 'br, gzip',
    });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    const headers = res.writeHead.mock.calls[0][1] as Record<string, string>;
    expect(headers['content-encoding']).toBe('br');
  });

  it('does not compress small responses', async () => {
    const timberHandler = vi.fn().mockResolvedValue(
      new Response('tiny', {
        headers: { 'Content-Type': 'text/html' },
      })
    );
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler, {
      compress: true,
    });

    const req = createMockIncomingMessage('GET', '/', {
      'host': 'localhost',
      'accept-encoding': 'gzip',
    });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    const headers = res.writeHead.mock.calls[0][1] as Record<string, string>;
    expect(headers['content-encoding']).toBeUndefined();
  });

  it('does not compress when Accept-Encoding is absent', async () => {
    const largeBody = 'a'.repeat(1024);
    const timberHandler = vi.fn().mockResolvedValue(
      new Response(largeBody, {
        headers: { 'Content-Type': 'text/html' },
      })
    );
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler, {
      compress: true,
    });

    const req = createMockIncomingMessage('GET', '/', { host: 'localhost' });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    const headers = res.writeHead.mock.calls[0][1] as Record<string, string>;
    expect(headers['content-encoding']).toBeUndefined();
  });

  it('does not compress already-encoded responses', async () => {
    const largeBody = 'a'.repeat(1024);
    const timberHandler = vi.fn().mockResolvedValue(
      new Response(largeBody, {
        headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'identity' },
      })
    );
    const adapter = node();
    const { requestHandler } = createNodeHandler(adapter, timberHandler, {
      compress: true,
    });

    const req = createMockIncomingMessage('GET', '/', {
      'host': 'localhost',
      'accept-encoding': 'gzip',
    });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    const headers = res.writeHead.mock.calls[0][1] as Record<string, string>;
    expect(headers['content-encoding']).toBe('identity');
  });
});

describe('waitUntil', () => {
  it('waitUntil collects promises', () => {
    const adapter = node();
    const p1 = Promise.resolve('a');
    const p2 = Promise.resolve('b');

    adapter.waitUntil!(p1);
    adapter.waitUntil!(p2);

    // Should not throw — promises are collected
    expect(true).toBe(true);
  });

  it('createNodeHandler waits for all waitUntil promises before closing', async () => {
    let resolved = false;
    const slowPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        resolved = true;
        resolve();
      }, 50);
    });

    const timberHandler = vi.fn().mockImplementation(async () => {
      adapter.waitUntil!(slowPromise);
      return new Response('ok');
    });

    const adapter = node();
    const { requestHandler, waitForPending } = createNodeHandler(adapter, timberHandler);

    const req = createMockIncomingMessage('GET', '/', { host: 'localhost' });
    const res = createMockServerResponse();

    await requestHandler(req, res);

    // Response was sent immediately
    expect(res.end).toHaveBeenCalled();

    // But the process should stay alive for the pending promise
    expect(resolved).toBe(false);
    await waitForPending();
    expect(resolved).toBe(true);
  });

  it('waitUntil rejected promises are logged but do not crash', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failingPromise = Promise.reject(new Error('background task failed'));

    const timberHandler = vi.fn().mockImplementation(async () => {
      adapter.waitUntil!(failingPromise);
      return new Response('ok');
    });

    const adapter = node();
    const { requestHandler, waitForPending } = createNodeHandler(adapter, timberHandler);

    const req = createMockIncomingMessage('GET', '/', { host: 'localhost' });
    const res = createMockServerResponse();

    await requestHandler(req, res);
    await waitForPending();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[timber]'),
      expect.any(Error)
    );

    consoleError.mockRestore();
  });
});

describe('options', () => {
  it('accepts custom hostname', () => {
    const adapter = node({ hostname: '0.0.0.0' });
    expect(adapter.name).toBe('node');
  });

  it('accepts custom port', () => {
    const adapter = node({ port: 8080 });
    expect(adapter.name).toBe('node');
  });

  it('compression defaults to true', () => {
    const adapter = node();
    expect(adapter.name).toBe('node');
  });

  it('compression can be disabled', () => {
    const adapter = node({ compress: false });
    expect(adapter.name).toBe('node');
  });
});

// ─── Test Helpers ──────────────────────────────────────────────────────────

import { EventEmitter } from 'node:events';

function createMockIncomingMessage(
  method: string,
  url: string,
  headers: Record<string, string> = {}
): NodeRequest & EventEmitter {
  const req = new EventEmitter() as NodeRequest & EventEmitter;
  req.method = method;
  req.url = url;
  req.headers = headers;

  // For GET requests, emit 'end' immediately
  if (method === 'GET' || method === 'HEAD') {
    setTimeout(() => req.emit('end'), 0);
  }

  return req;
}

/** Mock with vi.fn() methods that also satisfies NodeResponse. */
type MockServerResponse = NodeResponse & {
  writeHead: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  _written: string[];
};

function createMockServerResponse(): MockServerResponse {
  const written: string[] = [];
  return {
    writeHead: vi.fn(),
    write: vi.fn((chunk: Buffer | string) => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }),
    end: vi.fn((data?: string | Buffer) => {
      if (data) {
        written.push(typeof data === 'string' ? data : Buffer.from(data).toString());
      }
    }),
    _written: written,
  } as MockServerResponse;
}
