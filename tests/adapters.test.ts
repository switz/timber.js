/**
 * Cloudflare adapter production readiness tests.
 *
 * Tests the Cloudflare adapter's runtime behavior: waitUntil() binding,
 * env bindings passthrough, and wrangler config generation.
 *
 * Design docs: design/11-platform.md, design/25-production-deployments.md
 * Task: timber-zuk
 */

import { describe, it, expect } from 'vitest';
import {
  cloudflare,
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

// ─── adapter waitUntil ──────────────────────────────────────────────

describe('adapter waitUntil', () => {
  it('adapter has waitUntil method', () => {
    const adapter = cloudflare();
    expect(adapter.waitUntil).toBeDefined();
    expect(typeof adapter.waitUntil).toBe('function');
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

// ─── Bindings passthrough via runWithBindings ─────────────────────

describe('bindings passthrough via runWithBindings', () => {
  it('makes env accessible via getCloudflareBindings during request', () => {
    const env = { MY_KV: { get: () => 'test-value' }, API_KEY: 'secret' };

    let capturedBindings: Record<string, unknown> | null = null;
    runWithBindings(env, () => {
      capturedBindings = getCloudflareBindings();
    });

    expect(capturedBindings).toBe(env);
    expect(capturedBindings!.MY_KV).toBeDefined();
    expect(capturedBindings!.API_KEY).toBe('secret');
  });

  it('bindings not available after runWithBindings completes', () => {
    runWithBindings({ MY_KV: {} }, () => {
      // inside scope, bindings available
      expect(getCloudflareBindings()).toBeDefined();
    });

    // After the call, bindings should no longer be available
    expect(() => getCloudflareBindings()).toThrow();
  });
});

// ─── Worker entry structure ───────────────────────────────────────────────

describe('worker entry structure', () => {
  it('entry imports handler from rsc/index.js', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).toContain("import handler from '../rsc/index.js'");
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

  it('entry exports default with fetch handler', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).toContain('export default { fetch: handler }');
  });

  it('entry does not include manifest init import by default', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).not.toContain('_timber-manifest-init');
  });

  it('entry includes manifest init import when hasManifestInit is true', () => {
    const entry = generateWorkerEntry('/build', '/build/out', true);
    expect(entry).toContain("import './_timber-manifest-init.js'");
  });

  it('manifest init import comes before handler import', () => {
    const entry = generateWorkerEntry('/build', '/build/out', true);
    const manifestIdx = entry.indexOf("import './_timber-manifest-init.js'");
    const handlerIdx = entry.indexOf('import handler from');
    expect(manifestIdx).toBeLessThan(handlerIdx);
  });
});

// ─── Wrangler config ──────────────────────────────────────────────────────

describe('wrangler config', () => {
  it('main points to _worker.js', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    expect(config.main).toBe('_worker.js');
  });

  it('includes no_bundle and find_additional_modules', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    expect(config.no_bundle).toBe(true);
    expect(config.find_additional_modules).toBe(true);
  });

  it('includes ESModule rules for .js files', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    expect(config.rules).toEqual([{ type: 'ESModule', globs: ['**/*.js'] }]);
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
