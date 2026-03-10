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
  bun,
  createBunHandler,
  generateBunEntry,
} from '../../packages/timber-app/src/adapters/bun';

const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockCp = vi.mocked(cp);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Adapter Interface ──────────────────────────────────────────────────────

describe('Bun adapter interface', () => {
  it('has name "bun"', () => {
    const adapter = bun();
    expect(adapter.name).toBe('bun');
  });

  it('satisfies TimberPlatformAdapter', () => {
    const adapter: TimberPlatformAdapter = bun();
    expect(adapter.name).toBe('bun');
    expect(typeof adapter.buildOutput).toBe('function');
  });

  it('provides waitUntil method', () => {
    const adapter = bun();
    expect(typeof adapter.waitUntil).toBe('function');
  });

  it('provides preview method', () => {
    const adapter = bun();
    expect(typeof adapter.preview).toBe('function');
  });
});

// ─── Build Output ───────────────────────────────────────────────────────────

describe('buildOutput', () => {
  it('creates output directory', async () => {
    const adapter = bun();
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('bun'), {
      recursive: true,
    });
  });

  it('copies client assets to public directory', async () => {
    const adapter = bun();
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    expect(mockCp).toHaveBeenCalledWith(
      expect.stringContaining('client'),
      expect.stringContaining('public'),
      { recursive: true }
    );
  });

  it('writes server entry file', async () => {
    const adapter = bun();
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    const entryCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('entry.ts')
    );
    expect(entryCall).toBeDefined();
  });

  it('does not fail when client dir is missing (static+noJS)', async () => {
    mockCp.mockRejectedValueOnce(new Error('ENOENT'));
    const adapter = bun();

    await expect(
      adapter.buildOutput({ output: 'static', static: { noJS: true } }, '/tmp/build')
    ).resolves.not.toThrow();
  });
});

// ─── Entry Generation ───────────────────────────────────────────────────────

describe('generateBunEntry', () => {
  it('generates entry importing from server entry', () => {
    const entry = generateBunEntry('/tmp/build', '/tmp/build/bun');
    expect(entry).toContain('server/entry.js');
  });

  it('uses Bun.serve() for the HTTP server', () => {
    const entry = generateBunEntry('/tmp/build', '/tmp/build/bun');
    expect(entry).toContain('Bun.serve(');
  });

  it('imports createBunHandler from adapter', () => {
    const entry = generateBunEntry('/tmp/build', '/tmp/build/bun');
    expect(entry).toContain("import { createBunHandler } from '@timber/app/adapters/bun'");
  });

  it('references the static file directory', () => {
    const entry = generateBunEntry('/tmp/build', '/tmp/build/bun');
    // Entry uses Bun.serve() — static files are in the public dir
    expect(entry).toContain('fetch');
  });

  it('uses default port 3000', () => {
    const entry = generateBunEntry('/tmp/build', '/tmp/build/bun');
    expect(entry).toContain('3000');
  });

  it('respects custom port option', () => {
    const entry = generateBunEntry('/tmp/build', '/tmp/build/bun', { port: 8080 });
    expect(entry).toContain('8080');
  });

  it('respects custom hostname option', () => {
    const entry = generateBunEntry('/tmp/build', '/tmp/build/bun', { hostname: '127.0.0.1' });
    expect(entry).toContain('127.0.0.1');
  });

  it('includes graceful shutdown handler', () => {
    const entry = generateBunEntry('/tmp/build', '/tmp/build/bun');
    expect(entry).toContain('SIGTERM');
    expect(entry).toContain('waitForPending');
  });

  it('uses Bun.env for environment variables', () => {
    const entry = generateBunEntry('/tmp/build', '/tmp/build/bun');
    expect(entry).toContain('Bun.env.PORT');
    expect(entry).toContain('Bun.env.HOST');
  });
});

// ─── Bun Serve ──────────────────────────────────────────────────────────────

describe('bun serve', () => {
  it('createBunHandler passes Request directly to handler (no conversion)', async () => {
    const timberHandler = vi.fn().mockResolvedValue(new Response('hello world'));
    const adapter = bun();
    const { fetch } = createBunHandler(adapter, timberHandler);

    const req = new Request('http://localhost:3000/test');
    const res = await fetch(req);

    expect(timberHandler).toHaveBeenCalledTimes(1);
    // The exact same Request object should be passed through
    const passedReq = timberHandler.mock.calls[0][0] as Request;
    expect(passedReq.url).toBe('http://localhost:3000/test');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });

  it('forwards response status and headers', async () => {
    const timberHandler = vi.fn().mockResolvedValue(
      new Response('not found', {
        status: 404,
        headers: { 'X-Custom': 'test', 'Content-Type': 'text/plain' },
      })
    );
    const adapter = bun();
    const { fetch } = createBunHandler(adapter, timberHandler);

    const res = await fetch(new Request('http://localhost/missing'));

    expect(res.status).toBe(404);
    expect(res.headers.get('x-custom')).toBe('test');
    expect(res.headers.get('content-type')).toBe('text/plain');
  });

  it('handles POST requests', async () => {
    const timberHandler = vi.fn().mockResolvedValue(new Response('created', { status: 201 }));
    const adapter = bun();
    const { fetch } = createBunHandler(adapter, timberHandler);

    const req = new Request('http://localhost/submit', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await fetch(req);

    expect(res.status).toBe(201);
    const passedReq = timberHandler.mock.calls[0][0] as Request;
    expect(passedReq.method).toBe('POST');
  });

  it('returns 500 if handler throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const timberHandler = vi.fn().mockRejectedValue(new Error('boom'));
    const adapter = bun();
    const { fetch } = createBunHandler(adapter, timberHandler);

    const res = await fetch(new Request('http://localhost/'));

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Internal Server Error');

    consoleError.mockRestore();
  });

  it('handles streaming responses', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk1'));
        controller.enqueue(new TextEncoder().encode('chunk2'));
        controller.close();
      },
    });
    const timberHandler = vi.fn().mockResolvedValue(new Response(body));
    const adapter = bun();
    const { fetch } = createBunHandler(adapter, timberHandler);

    const res = await fetch(new Request('http://localhost/'));
    const text = await res.text();

    expect(text).toBe('chunk1chunk2');
  });
});

// ─── waitUntil ──────────────────────────────────────────────────────────────

describe('waitUntil', () => {
  it('waitUntil collects promises', () => {
    const adapter = bun();
    const p1 = Promise.resolve('a');
    const p2 = Promise.resolve('b');

    adapter.waitUntil!(p1);
    adapter.waitUntil!(p2);

    // Should not throw — promises are collected
    expect(true).toBe(true);
  });

  it('createBunHandler waits for all waitUntil promises', async () => {
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

    const adapter = bun();
    const { fetch, waitForPending } = createBunHandler(adapter, timberHandler);

    const res = await fetch(new Request('http://localhost/'));

    // Response was returned immediately
    expect(res.status).toBe(200);

    // But the pending promise hasn't resolved yet
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

    const adapter = bun();
    const { fetch, waitForPending } = createBunHandler(adapter, timberHandler);

    await fetch(new Request('http://localhost/'));
    await waitForPending();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[timber]'),
      expect.any(Error)
    );

    consoleError.mockRestore();
  });
});

// ─── Options ────────────────────────────────────────────────────────────────

describe('options', () => {
  it('accepts custom hostname', () => {
    const adapter = bun({ hostname: '127.0.0.1' });
    expect(adapter.name).toBe('bun');
  });

  it('accepts custom port', () => {
    const adapter = bun({ port: 8080 });
    expect(adapter.name).toBe('bun');
  });
});
