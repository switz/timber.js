/**
 * Instrumentation and observability tests.
 *
 * Validates that instrumentation.ts lifecycle hooks work correctly
 * in production contexts: register() blocks server startup,
 * onRequestError() fires for unhandled errors, TIMBER_RUNTIME is
 * set correctly per adapter, and trace context propagation works.
 *
 * Design docs: design/11-platform.md, design/25-production-deployments.md
 * Task: timber-a3d
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadInstrumentation,
  callOnRequestError,
  hasOnRequestError,
  resetInstrumentation,
} from '../packages/timber-app/src/server/instrumentation';
import type {
  InstrumentationRequestInfo,
  InstrumentationErrorContext,
} from '../packages/timber-app/src/server/instrumentation';
import {
  traceId,
  generateTraceId,
  runWithTraceId,
  replaceTraceId,
  spanId,
  getTraceStore,
} from '../packages/timber-app/src/server/tracing';
import { generateWorkerEntry } from '../packages/timber-app/src/adapters/cloudflare';
import { generateNitroEntry, getPresetConfig } from '../packages/timber-app/src/adapters/nitro';
import type { NitroPreset } from '../packages/timber-app/src/adapters/nitro';

beforeEach(() => {
  resetInstrumentation();
});

// ─── register blocks startup ─────────────────────────────────────────────

describe('register blocks startup', () => {
  it('loadInstrumentation awaits register() before returning', async () => {
    const order: string[] = [];

    await loadInstrumentation(async () => ({
      register: async () => {
        // Simulate async startup work (SDK init, connection pool, etc.)
        await new Promise((r) => setTimeout(r, 50));
        order.push('register-done');
      },
    }));

    order.push('load-done');

    // register must complete before loadInstrumentation resolves
    expect(order).toEqual(['register-done', 'load-done']);
  });

  it('register() throwing propagates the error', async () => {
    await expect(
      loadInstrumentation(async () => ({
        register: async () => {
          throw new Error('SDK init failed');
        },
      }))
    ).rejects.toThrow('SDK init failed');
  });

  it('loadInstrumentation is idempotent', async () => {
    let callCount = 0;

    await loadInstrumentation(async () => ({
      register: () => {
        callCount++;
      },
    }));

    await loadInstrumentation(async () => ({
      register: () => {
        callCount++;
      },
    }));

    expect(callCount).toBe(1);
  });

  it('missing register() is not an error', async () => {
    // Module exists but exports no register()
    await expect(loadInstrumentation(async () => ({}))).resolves.not.toThrow();
  });

  it('null module (no instrumentation.ts) is not an error', async () => {
    await expect(loadInstrumentation(async () => null)).resolves.not.toThrow();
  });
});

// ─── onRequestError ──────────────────────────────────────────────────────

describe('onRequestError', () => {
  const mockRequest: InstrumentationRequestInfo = {
    method: 'GET',
    path: '/dashboard',
    headers: { 'user-agent': 'test' },
  };

  const mockContext: InstrumentationErrorContext = {
    phase: 'render',
    routePath: '/dashboard',
    routeType: 'page',
    traceId: 'abc123',
  };

  it('fires when an error occurs', async () => {
    let capturedError: unknown = null;
    let capturedRequest: InstrumentationRequestInfo | null = null;
    let capturedContext: InstrumentationErrorContext | null = null;

    await loadInstrumentation(async () => ({
      onRequestError: (err, req, ctx) => {
        capturedError = err;
        capturedRequest = req;
        capturedContext = ctx;
      },
    }));

    const testError = new Error('render failed');
    await callOnRequestError(testError, mockRequest, mockContext);

    expect(capturedError).toBe(testError);
    expect(capturedRequest).toBe(mockRequest);
    expect(capturedContext).toBe(mockContext);
  });

  it('hasOnRequestError returns true when hook is registered', async () => {
    await loadInstrumentation(async () => ({
      onRequestError: () => {},
    }));

    expect(hasOnRequestError()).toBe(true);
  });

  it('hasOnRequestError returns false when no hook', async () => {
    await loadInstrumentation(async () => ({}));
    expect(hasOnRequestError()).toBe(false);
  });

  it('onRequestError hook error does not propagate', async () => {
    await loadInstrumentation(async () => ({
      onRequestError: () => {
        throw new Error('hook itself failed');
      },
    }));

    // Should not throw — hook errors are swallowed with console.error
    await expect(
      callOnRequestError(new Error('test'), mockRequest, mockContext)
    ).resolves.not.toThrow();
  });

  it('receives correct phase information', async () => {
    let capturedPhase: string | null = null;

    await loadInstrumentation(async () => ({
      onRequestError: (_err, _req, ctx) => {
        capturedPhase = ctx.phase;
      },
    }));

    await callOnRequestError(new Error('test'), mockRequest, {
      ...mockContext,
      phase: 'action',
    });

    expect(capturedPhase).toBe('action');
  });

  it('receives trace ID in error context', async () => {
    let capturedTraceId: string | null = null;

    await loadInstrumentation(async () => ({
      onRequestError: (_err, _req, ctx) => {
        capturedTraceId = ctx.traceId;
      },
    }));

    await callOnRequestError(new Error('test'), mockRequest, {
      ...mockContext,
      traceId: 'trace-abc-123',
    });

    expect(capturedTraceId).toBe('trace-abc-123');
  });

  it('callOnRequestError is a no-op when no hook registered', async () => {
    await loadInstrumentation(async () => ({}));

    // Should not throw
    await expect(
      callOnRequestError(new Error('test'), mockRequest, mockContext)
    ).resolves.not.toThrow();
  });
});

// ─── cloudflare runtime ──────────────────────────────────────────────────

describe('cloudflare runtime', () => {
  it('generated entry sets TIMBER_RUNTIME to cloudflare', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).toContain("process.env.TIMBER_RUNTIME = 'cloudflare'");
  });

  it('TIMBER_RUNTIME is set before export', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    const runtimeLine = entry.indexOf("TIMBER_RUNTIME = 'cloudflare'");
    const exportLine = entry.indexOf('export default { fetch: handler }');
    expect(runtimeLine).toBeLessThan(exportLine);
  });

  it('TIMBER_RUNTIME is available via process.env', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    // Entry sets up process.env polyfill first
    expect(entry).toContain('globalThis.process ??= { env: {} }');
    // Then sets TIMBER_RUNTIME — check assignment line ordering
    const processLine = entry.indexOf('globalThis.process ??=');
    const runtimeLine = entry.indexOf("process.env.TIMBER_RUNTIME = 'cloudflare'");
    expect(processLine).toBeLessThan(runtimeLine);
  });
});

// ─── nitro runtime ───────────────────────────────────────────────────────

describe('nitro runtime', () => {
  const presets: NitroPreset[] = [
    'node-server',
    'bun',
    'vercel',
    'vercel-edge',
    'netlify',
    'netlify-edge',
    'aws-lambda',
    'deno-deploy',
    'azure-functions',
  ];

  for (const preset of presets) {
    it(`sets TIMBER_RUNTIME to '${preset}' for ${preset} preset`, () => {
      const entry = generateNitroEntry('/build', '/build/out', preset);
      const config = getPresetConfig(preset);
      expect(entry).toContain(`process.env.TIMBER_RUNTIME = '${config.runtimeName}'`);
    });
  }

  it('TIMBER_RUNTIME is set before handler is called', () => {
    const entry = generateNitroEntry('/build', '/build/out', 'node-server');
    const runtimeLine = entry.indexOf("process.env.TIMBER_RUNTIME = 'node-server'");
    // Find the export default usage, not the import
    const handlerLine = entry.indexOf('export default defineEventHandler');
    expect(runtimeLine).toBeLessThan(handlerLine);
  });
});

// ─── Trace context propagation ───────────────────────────────────────────

describe('trace context propagation', () => {
  it('generateTraceId returns 32-char hex string', () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generateTraceId returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });

  it('traceId() returns the current request trace ID', () => {
    const id = generateTraceId();
    runWithTraceId(id, () => {
      expect(traceId()).toBe(id);
    });
  });

  it('traceId() throws outside request context', () => {
    expect(() => traceId()).toThrow('outside of a request context');
  });

  it('nested runWithTraceId isolates trace IDs', () => {
    const outer = generateTraceId();
    const inner = generateTraceId();

    runWithTraceId(outer, () => {
      expect(traceId()).toBe(outer);

      runWithTraceId(inner, () => {
        expect(traceId()).toBe(inner);
      });

      // Outer is restored after inner scope exits
      expect(traceId()).toBe(outer);
    });
  });

  it('replaceTraceId updates the current trace', () => {
    const initial = generateTraceId();
    const replacement = generateTraceId();

    runWithTraceId(initial, () => {
      expect(traceId()).toBe(initial);
      replaceTraceId(replacement, 'span-abc');
      expect(traceId()).toBe(replacement);
      expect(spanId()).toBe('span-abc');
    });
  });

  it('getTraceStore returns undefined outside request', () => {
    expect(getTraceStore()).toBeUndefined();
  });

  it('getTraceStore returns store within request', () => {
    const id = generateTraceId();
    runWithTraceId(id, () => {
      const store = getTraceStore();
      expect(store).toBeDefined();
      expect(store!.traceId).toBe(id);
    });
  });

  it('concurrent requests maintain isolated trace contexts', async () => {
    const results: string[] = [];
    const id1 = generateTraceId();
    const id2 = generateTraceId();

    await Promise.all([
      new Promise<void>((resolve) => {
        runWithTraceId(id1, async () => {
          await new Promise((r) => setTimeout(r, 10));
          results.push(traceId());
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        runWithTraceId(id2, async () => {
          await new Promise((r) => setTimeout(r, 5));
          results.push(traceId());
          resolve();
        });
      }),
    ]);

    // Each request sees its own trace ID — no cross-request pollution
    expect(results).toContain(id1);
    expect(results).toContain(id2);
    expect(results).toHaveLength(2);
  });
});
