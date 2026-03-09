import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cloudflare,
  wrapWithExecutionContext,
  generateWorkerEntry,
  generateWranglerConfig,
} from '../../packages/timber-app/src/adapters/cloudflare';
import type { TimberPlatformAdapter } from '../../packages/timber-app/src/adapters/types';

// Mock node:fs/promises at the module level for ESM compatibility
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
}));

import { writeFile, mkdir, cp } from 'node:fs/promises';

const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockCp = vi.mocked(cp);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TimberPlatformAdapter interface', () => {
  it('defines the required interface shape', () => {
    const adapter = cloudflare();
    expect(adapter).toHaveProperty('name');
    expect(typeof adapter.name).toBe('string');
    expect(adapter).toHaveProperty('buildOutput');
    expect(typeof adapter.buildOutput).toBe('function');
  });

  it('defines optional waitUntil method', () => {
    const adapter = cloudflare();
    expect(typeof adapter.waitUntil).toBe('function');
  });

  it('defines optional preview method', () => {
    const adapter = cloudflare();
    // Cloudflare adapter doesn't provide preview — falls back to built-in
    expect(adapter.preview).toBeUndefined();
  });
});

describe('Cloudflare adapter implements interface', () => {
  it('has name "cloudflare"', () => {
    const adapter = cloudflare();
    expect(adapter.name).toBe('cloudflare');
  });

  it('satisfies TimberPlatformAdapter', () => {
    const adapter: TimberPlatformAdapter = cloudflare();
    expect(adapter.name).toBe('cloudflare');
  });

  it('buildOutput creates output directory and writes files', async () => {
    const adapter = cloudflare({ compatibilityDate: '2026-03-01' });
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    // Should create output directory
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('cloudflare'), {
      recursive: true,
    });

    // Should write wrangler.jsonc
    const wranglerCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('wrangler.jsonc')
    );
    expect(wranglerCall).toBeDefined();

    // Should write worker entry
    const workerCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('_worker.ts')
    );
    expect(workerCall).toBeDefined();
  });

  it('buildOutput copies client assets to static directory', async () => {
    const adapter = cloudflare({ compatibilityDate: '2026-03-01' });
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    expect(mockCp).toHaveBeenCalledWith(
      expect.stringContaining('client'),
      expect.stringContaining('static'),
      { recursive: true }
    );
  });
});

describe('generateWranglerConfig', () => {
  it('generates config with specified compatibility date', () => {
    const config = generateWranglerConfig(
      { output: 'server' },
      { compatibilityDate: '2026-03-01' }
    );
    expect(config.compatibility_date).toBe('2026-03-01');
    expect(config.compatibility_flags).toContain('nodejs_compat');
    expect(config.main).toBe('_worker.ts');
  });

  it('uses current date as default compatibility date', () => {
    const config = generateWranglerConfig({ output: 'server' }, {});
    expect(config.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('merges custom wrangler options', () => {
    const config = generateWranglerConfig(
      { output: 'server' },
      {
        compatibilityDate: '2026-01-01',
        wrangler: { name: 'my-app', vars: { API_KEY: 'test' } },
      }
    );
    expect(config.name).toBe('my-app');
    expect(config.vars).toEqual({ API_KEY: 'test' });
  });

  it('generates static assets directory config', () => {
    const config = generateWranglerConfig(
      { output: 'server' },
      { compatibilityDate: '2026-03-01' }
    );
    expect(config.assets).toEqual({ directory: './static' });
  });

  it('supports custom compatibility flags', () => {
    const config = generateWranglerConfig(
      { output: 'server' },
      {
        compatibilityDate: '2026-03-01',
        compatibilityFlags: ['nodejs_compat', 'streams_enable_constructors'],
      }
    );
    expect(config.compatibility_flags).toEqual(['nodejs_compat', 'streams_enable_constructors']);
  });
});

describe('generateWorkerEntry', () => {
  it('generates entry importing wrapWithExecutionContext', () => {
    const entry = generateWorkerEntry('/tmp/build', '/tmp/build/cloudflare');
    expect(entry).toContain('wrapWithExecutionContext');
    expect(entry).toContain('@timber/app/adapters/cloudflare');
  });

  it('generates relative import to server entry', () => {
    const entry = generateWorkerEntry('/tmp/build', '/tmp/build/cloudflare');
    expect(entry).toContain('server/entry.js');
  });
});

describe('waitUntil maps to ctx.waitUntil()', () => {
  it('wrapWithExecutionContext routes waitUntil to execution context', async () => {
    const ctxWaitUntil = vi.fn();
    const mockCtx: ExecutionContext = {
      waitUntil: ctxWaitUntil,
      passThroughOnException: vi.fn(),
    };

    let capturedAdapter: TimberPlatformAdapter | null = null;
    const handler = async (_req: Request): Promise<Response> => {
      if (capturedAdapter?.waitUntil) {
        capturedAdapter.waitUntil(Promise.resolve('background-work'));
      }
      return new Response('ok');
    };

    const adapter = cloudflare();
    capturedAdapter = adapter;

    const worker = wrapWithExecutionContext(adapter, handler);
    const response = await worker.fetch!(new Request('https://example.com/'), {}, mockCtx);

    expect(response.status).toBe(200);
    expect(ctxWaitUntil).toHaveBeenCalledTimes(1);
    expect(ctxWaitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it('waitUntil receives the exact promise passed by user code', async () => {
    const ctxWaitUntil = vi.fn();
    const mockCtx: ExecutionContext = {
      waitUntil: ctxWaitUntil,
      passThroughOnException: vi.fn(),
    };

    const backgroundPromise = new Promise<void>((resolve) => setTimeout(resolve, 10));
    const adapter = cloudflare();

    const handler = async (_req: Request): Promise<Response> => {
      adapter.waitUntil!(backgroundPromise);
      return new Response('ok');
    };

    const worker = wrapWithExecutionContext(adapter, handler);
    await worker.fetch!(new Request('https://example.com/'), {}, mockCtx);

    expect(ctxWaitUntil).toHaveBeenCalledWith(backgroundPromise);
  });

  it('multiple waitUntil calls within a request all route to ctx', async () => {
    const ctxWaitUntil = vi.fn();
    const mockCtx: ExecutionContext = {
      waitUntil: ctxWaitUntil,
      passThroughOnException: vi.fn(),
    };

    const adapter = cloudflare();

    const handler = async (_req: Request): Promise<Response> => {
      adapter.waitUntil!(Promise.resolve('work-1'));
      adapter.waitUntil!(Promise.resolve('work-2'));
      adapter.waitUntil!(Promise.resolve('work-3'));
      return new Response('ok');
    };

    const worker = wrapWithExecutionContext(adapter, handler);
    await worker.fetch!(new Request('https://example.com/'), {}, mockCtx);

    expect(ctxWaitUntil).toHaveBeenCalledTimes(3);
  });

  it('waitUntil is restored after request completes', async () => {
    const mockCtx: ExecutionContext = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };

    const adapter = cloudflare();
    const originalWaitUntil = adapter.waitUntil;

    const handler = async (_req: Request): Promise<Response> => {
      return new Response('ok');
    };

    const worker = wrapWithExecutionContext(adapter, handler);
    await worker.fetch!(new Request('https://example.com/'), {}, mockCtx);

    expect(adapter.waitUntil).toBe(originalWaitUntil);
  });

  it('waitUntil is restored even if handler throws', async () => {
    const mockCtx: ExecutionContext = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };

    const adapter = cloudflare();
    const originalWaitUntil = adapter.waitUntil;

    const handler = async (_req: Request): Promise<Response> => {
      throw new Error('handler error');
    };

    const worker = wrapWithExecutionContext(adapter, handler);

    await expect(worker.fetch!(new Request('https://example.com/'), {}, mockCtx)).rejects.toThrow(
      'handler error'
    );

    expect(adapter.waitUntil).toBe(originalWaitUntil);
  });
});
