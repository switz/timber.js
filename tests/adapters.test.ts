/**
 * Cloudflare adapter production readiness tests.
 *
 * Tests the Cloudflare adapter's runtime behavior: wrapWithExecutionContext,
 * waitUntil() binding, env bindings passthrough, and wrangler config generation.
 *
 * Design docs: design/11-platform.md, design/25-production-deployments.md
 * Task: timber-zuk
 */

import { describe, it, expect } from 'vitest';
import {
  cloudflare,
  wrapWithExecutionContext,
  getCloudflareBindings,
  runWithBindings,
  generateWorkerEntry,
  generateWranglerConfig,
} from '../packages/timber-app/src/adapters/cloudflare';
import type { TimberConfig } from '../packages/timber-app/src/adapters/types';

const SERVER_CONFIG: TimberConfig = { output: 'server' };

// ─── cloudflare compat flags ──────────────────────────────────────────────

describe('cloudflare compat flags', () => {
  it('default flags include nodejs_compat', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    expect(config.compatibility_flags).toContain('nodejs_compat');
  });

  it('nodejs_compat is required for node:async_hooks, node:crypto, etc.', () => {
    // The adapter uses node:async_hooks for ALS-based bindings passthrough.
    // Without nodejs_compat, Workers cannot import node:* modules.
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    expect(config.compatibility_flags).toEqual(['nodejs_compat']);
  });

  it('custom flags replace defaults', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {
      compatibilityFlags: ['nodejs_compat', 'streams_enable_constructors'],
    });
    expect(config.compatibility_flags).toEqual(['nodejs_compat', 'streams_enable_constructors']);
  });

  it('compatibility_date defaults to current date', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    const today = new Date().toISOString().slice(0, 10);
    expect(config.compatibility_date).toBe(today);
  });

  it('custom compatibility_date is respected', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {
      compatibilityDate: '2025-12-01',
    });
    expect(config.compatibility_date).toBe('2025-12-01');
  });
});

// ─── wrapWithExecutionContext ──────────────────────────────────────────────

describe('wrapWithExecutionContext', () => {
  /** Create a mock ExecutionContext for testing. */
  function createMockExecutionContext() {
    const waitUntilPromises: Promise<unknown>[] = [];
    return {
      ctx: {
        waitUntil(promise: Promise<unknown>) {
          waitUntilPromises.push(promise);
        },
        passThroughOnException() {},
      } as ExecutionContext,
      waitUntilPromises,
    };
  }

  it('delegates waitUntil to ExecutionContext.waitUntil', async () => {
    const adapter = cloudflare();
    const { ctx, waitUntilPromises } = createMockExecutionContext();

    const handler = async (_req: Request) => {
      // Simulate calling waitUntil during request handling
      adapter.waitUntil!(Promise.resolve('background-work'));
      return new Response('ok');
    };

    const wrapped = wrapWithExecutionContext(adapter, handler);
    await wrapped.fetch!(new Request('http://localhost/'), {}, ctx);

    expect(waitUntilPromises).toHaveLength(1);
    await expect(waitUntilPromises[0]).resolves.toBe('background-work');
  });

  it('restores original waitUntil after request completes', async () => {
    const adapter = cloudflare();
    const originalWaitUntil = adapter.waitUntil;
    const { ctx } = createMockExecutionContext();

    const handler = async () => new Response('ok');
    const wrapped = wrapWithExecutionContext(adapter, handler);

    await wrapped.fetch!(new Request('http://localhost/'), {}, ctx);

    // After the request, the adapter's waitUntil should be restored
    expect(adapter.waitUntil).toBe(originalWaitUntil);
  });

  it('restores waitUntil even if handler throws', async () => {
    const adapter = cloudflare();
    const originalWaitUntil = adapter.waitUntil;
    const { ctx } = createMockExecutionContext();

    const handler = async () => {
      throw new Error('handler failed');
    };
    const wrapped = wrapWithExecutionContext(adapter, handler);

    await expect(wrapped.fetch!(new Request('http://localhost/'), {}, ctx)).rejects.toThrow(
      'handler failed'
    );

    expect(adapter.waitUntil).toBe(originalWaitUntil);
  });

  it('passes request through to handler', async () => {
    const adapter = cloudflare();
    const { ctx } = createMockExecutionContext();

    let receivedUrl = '';
    const handler = async (req: Request) => {
      receivedUrl = req.url;
      return new Response('ok');
    };

    const wrapped = wrapWithExecutionContext(adapter, handler);
    await wrapped.fetch!(new Request('http://localhost/test-path'), {}, ctx);

    expect(receivedUrl).toBe('http://localhost/test-path');
  });

  it('returns handler response', async () => {
    const adapter = cloudflare();
    const { ctx } = createMockExecutionContext();

    const handler = async () => new Response('hello', { status: 201 });
    const wrapped = wrapWithExecutionContext(adapter, handler);

    const response = await wrapped.fetch!(new Request('http://localhost/'), {}, ctx);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('hello');
  });
});

// ─── getCloudflareBindings ────────────────────────────────────────────────

describe('getCloudflareBindings', () => {
  it('returns env when called within runWithBindings', () => {
    const env = { MY_KV: { get: () => 'value' }, MY_DB: {} };

    const result = runWithBindings(env, () => {
      return getCloudflareBindings();
    });

    expect(result).toBe(env);
    expect(result.MY_KV).toBeDefined();
    expect(result.MY_DB).toBeDefined();
  });

  it('throws outside request context', () => {
    expect(() => getCloudflareBindings()).toThrow(
      'getCloudflareBindings() called outside a Cloudflare Workers request context'
    );
  });

  it('supports typed bindings via generic', () => {
    type MyBindings = Record<string, unknown> & {
      MY_KV: { get(key: string): Promise<string | null> };
      MY_R2: { put(key: string, body: ReadableStream): Promise<void> };
    };

    const mockKV = { get: async (key: string) => `value-${key}` };
    const mockR2 = { put: async () => {} };

    runWithBindings({ MY_KV: mockKV, MY_R2: mockR2 }, () => {
      const bindings = getCloudflareBindings<MyBindings>();
      expect(bindings.MY_KV).toBe(mockKV);
      expect(bindings.MY_R2).toBe(mockR2);
    });
  });

  it('isolates bindings per-request (no cross-request leakage)', async () => {
    const results: string[] = [];

    await Promise.all([
      new Promise<void>((resolve) => {
        runWithBindings({ REQUEST_ID: 'req-1' }, async () => {
          // Simulate async work
          await new Promise((r) => setTimeout(r, 10));
          const bindings = getCloudflareBindings();
          results.push(bindings.REQUEST_ID as string);
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        runWithBindings({ REQUEST_ID: 'req-2' }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          const bindings = getCloudflareBindings();
          results.push(bindings.REQUEST_ID as string);
          resolve();
        });
      }),
    ]);

    // Each request sees its own bindings — no cross-request pollution
    expect(results).toContain('req-1');
    expect(results).toContain('req-2');
    expect(results).toHaveLength(2);
  });
});

// ─── Bindings passthrough via wrapWithExecutionContext ─────────────────────

describe('bindings passthrough via wrapWithExecutionContext', () => {
  it('makes env accessible via getCloudflareBindings during request', async () => {
    const adapter = cloudflare();
    const ctx = {
      waitUntil() {},
      passThroughOnException() {},
    } as ExecutionContext;

    const env = { MY_KV: { get: () => 'test-value' }, API_KEY: 'secret' };

    let capturedBindings: Record<string, unknown> | null = null;
    const handler = async () => {
      capturedBindings = getCloudflareBindings();
      return new Response('ok');
    };

    const wrapped = wrapWithExecutionContext(adapter, handler);
    await wrapped.fetch!(new Request('http://localhost/'), env, ctx);

    expect(capturedBindings).toBe(env);
    expect(capturedBindings!.MY_KV).toBeDefined();
    expect(capturedBindings!.API_KEY).toBe('secret');
  });

  it('bindings not available after request completes', async () => {
    const adapter = cloudflare();
    const ctx = {
      waitUntil() {},
      passThroughOnException() {},
    } as ExecutionContext;

    const handler = async () => new Response('ok');
    const wrapped = wrapWithExecutionContext(adapter, handler);

    await wrapped.fetch!(new Request('http://localhost/'), { MY_KV: {} }, ctx);

    // After the request, bindings should no longer be available
    expect(() => getCloudflareBindings()).toThrow();
  });
});

// ─── Worker entry structure ───────────────────────────────────────────────

describe('worker entry structure', () => {
  it('entry imports wrapWithExecutionContext from adapter', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).toContain(
      "import { wrapWithExecutionContext } from '@timber/app/adapters/cloudflare'"
    );
  });

  it('entry imports handler and adapter from server entry', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).toContain("import { handler, adapter } from '../server/entry.js'");
  });

  it('entry sets up process.env polyfill for Workers', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    // Workers don't have process by default
    expect(entry).toContain('globalThis.process ??= { env: {} }');
  });

  it('entry sets TIMBER_RUNTIME to cloudflare', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).toContain("process.env.TIMBER_RUNTIME = 'cloudflare'");
  });

  it('entry exports default wrapWithExecutionContext result', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).toContain('export default wrapWithExecutionContext(adapter, handler)');
  });
});

// ─── Wrangler config ──────────────────────────────────────────────────────

describe('wrangler config', () => {
  it('main points to _worker.ts', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    expect(config.main).toBe('_worker.ts');
  });

  it('assets directory points to static/', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    expect(config.assets).toEqual({ directory: './static' });
  });

  it('default name is timber-app', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    expect(config.name).toBe('timber-app');
  });

  it('custom wrangler overrides merge correctly', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {
      wrangler: {
        name: 'my-production-app',
        kv_namespaces: [{ binding: 'CACHE', id: 'abc123' }],
        d1_databases: [{ binding: 'DB', database_id: 'def456' }],
      },
    });

    expect(config.name).toBe('my-production-app');
    expect(config.kv_namespaces).toEqual([{ binding: 'CACHE', id: 'abc123' }]);
    expect(config.d1_databases).toEqual([{ binding: 'DB', database_id: 'def456' }]);
  });
});
