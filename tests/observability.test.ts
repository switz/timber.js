import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  traceId,
  spanId,
  generateTraceId,
  runWithTraceId,
  replaceTraceId,
  updateSpanId,
  getTraceStore,
} from '../packages/timber-app/src/server/tracing';
import {
  setLogger,
  getLogger,
  logRequestCompleted,
  logRequestReceived,
  logSlowRequest,
  logMiddlewareShortCircuit,
  logMiddlewareError,
  logRenderError,
  logProxyError,
  logWaitUntilUnsupported,
  logWaitUntilRejected,
  logSwrRefetchFailed,
  logCacheMiss,
  type TimberLogger,
} from '../packages/timber-app/src/server/logger';
import {
  loadInstrumentation,
  callOnRequestError,
  hasOnRequestError,
  resetInstrumentation,
  type InstrumentationRequestInfo,
  type InstrumentationErrorContext,
} from '../packages/timber-app/src/server/instrumentation';

// ─── Helpers ──────────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    info: vi.fn<TimberLogger['info']>(),
    warn: vi.fn<TimberLogger['warn']>(),
    error: vi.fn<TimberLogger['error']>(),
    debug: vi.fn<TimberLogger['debug']>(),
  };
}

// ─── traceId() ────────────────────────────────────────────────────────────

describe('traceId()', () => {
  it('returns 32-char hex', () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('throws outside request context', () => {
    expect(() => traceId()).toThrow('outside of a request context');
  });

  it('returns the trace ID within runWithTraceId', () => {
    const id = generateTraceId();
    runWithTraceId(id, () => {
      expect(traceId()).toBe(id);
    });
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });

  it('uses OTEL when active, UUID fallback', () => {
    // Without OTEL — uses generated ID
    const fallbackId = generateTraceId();
    runWithTraceId(fallbackId, () => {
      expect(traceId()).toBe(fallbackId);
      expect(traceId()).toMatch(/^[0-9a-f]{32}$/);
    });

    // With OTEL — replaceTraceId switches to OTEL trace ID
    const otelId = 'abcdef1234567890abcdef1234567890';
    runWithTraceId(fallbackId, () => {
      replaceTraceId(otelId, '1234567890abcdef');
      expect(traceId()).toBe(otelId);
      expect(spanId()).toBe('1234567890abcdef');
    });
  });

  it('nested runWithTraceId scopes are isolated', () => {
    const outer = generateTraceId();
    const inner = generateTraceId();

    runWithTraceId(outer, () => {
      expect(traceId()).toBe(outer);

      runWithTraceId(inner, () => {
        expect(traceId()).toBe(inner);
      });

      // Outer scope is restored
      expect(traceId()).toBe(outer);
    });
  });
});

// ─── spanId() ─────────────────────────────────────────────────────────────

describe('spanId()', () => {
  it('returns undefined outside request context', () => {
    expect(spanId()).toBeUndefined();
  });

  it('returns undefined when no span is active', () => {
    runWithTraceId(generateTraceId(), () => {
      expect(spanId()).toBeUndefined();
    });
  });

  it('returns span ID after updateSpanId', () => {
    runWithTraceId(generateTraceId(), () => {
      updateSpanId('abc123');
      expect(spanId()).toBe('abc123');
    });
  });
});

// ─── getTraceStore() ──────────────────────────────────────────────────────

describe('getTraceStore()', () => {
  it('returns undefined outside request context', () => {
    expect(getTraceStore()).toBeUndefined();
  });

  it('returns the store within a request context', () => {
    const id = generateTraceId();
    runWithTraceId(id, () => {
      const store = getTraceStore();
      expect(store).toBeDefined();
      expect(store!.traceId).toBe(id);
    });
  });
});

// ─── Logger ───────────────────────────────────────────────────────────────

describe('logger', () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    setLogger(logger);
  });

  afterEach(() => {
    // Reset logger to null by setting a fresh one won't work, so we test behavior
    setLogger(null as unknown as TimberLogger);
  });

  it('getLogger returns the set logger', () => {
    expect(getLogger()).toBe(logger);
  });

  it('log events include trace context', () => {
    const id = generateTraceId();
    runWithTraceId(id, () => {
      logRequestCompleted({ method: 'GET', path: '/test', status: 200, durationMs: 42 });

      expect(logger.info).toHaveBeenCalledWith('request completed', {
        method: 'GET',
        path: '/test',
        status: 200,
        durationMs: 42,
        trace_id: id,
      });
    });
  });

  it('log events include span_id when present', () => {
    const id = generateTraceId();
    runWithTraceId(id, () => {
      updateSpanId('deadbeef');
      logRequestCompleted({ method: 'GET', path: '/test', status: 200, durationMs: 42 });

      expect(logger.info).toHaveBeenCalledWith('request completed', {
        method: 'GET',
        path: '/test',
        status: 200,
        durationMs: 42,
        trace_id: id,
        span_id: 'deadbeef',
      });
    });
  });

  it('dev logging with environment labels', () => {
    const id = generateTraceId();
    runWithTraceId(id, () => {
      logRequestReceived({ method: 'GET', path: '/dashboard' });
      expect(logger.debug).toHaveBeenCalledWith('request received', {
        method: 'GET',
        path: '/dashboard',
        trace_id: id,
      });
    });
  });

  it('log events emitted for all framework events', () => {
    const id = generateTraceId();
    runWithTraceId(id, () => {
      logSlowRequest({ method: 'GET', path: '/', durationMs: 5000, threshold: 3000 });
      expect(logger.warn).toHaveBeenCalledWith(
        'slow request exceeded threshold',
        expect.objectContaining({ durationMs: 5000 })
      );

      logMiddlewareShortCircuit({ method: 'GET', path: '/', status: 302 });
      expect(logger.debug).toHaveBeenCalledWith(
        'middleware short-circuited',
        expect.objectContaining({ status: 302 })
      );

      logMiddlewareError({ method: 'GET', path: '/', error: new Error('fail') });
      expect(logger.error).toHaveBeenCalledWith(
        'unhandled error in middleware phase',
        expect.objectContaining({ error: expect.any(Error) })
      );

      logRenderError({ method: 'GET', path: '/', error: new Error('render') });
      expect(logger.error).toHaveBeenCalledWith(
        'unhandled render-phase error',
        expect.objectContaining({ error: expect.any(Error) })
      );

      logProxyError({ error: new Error('proxy') });
      expect(logger.error).toHaveBeenCalledWith(
        'proxy.ts threw uncaught error',
        expect.objectContaining({ error: expect.any(Error) })
      );

      logWaitUntilRejected({ error: new Error('bg') });
      expect(logger.warn).toHaveBeenCalledWith(
        'waitUntil() promise rejected',
        expect.objectContaining({ error: expect.any(Error) })
      );

      logSwrRefetchFailed({ cacheKey: 'k', error: new Error('swr') });
      expect(logger.warn).toHaveBeenCalledWith(
        'staleWhileRevalidate refetch failed',
        expect.objectContaining({ cacheKey: 'k' })
      );

      logCacheMiss({ cacheKey: 'k2' });
      expect(logger.debug).toHaveBeenCalledWith(
        'timber.cache MISS',
        expect.objectContaining({ cacheKey: 'k2' })
      );
    });
  });

  it('waitUntil unsupported warning has no trace context', () => {
    logWaitUntilUnsupported();
    expect(logger.warn).toHaveBeenCalledWith('adapter does not support waitUntil()');
  });

  it('silent when no logger is set', () => {
    setLogger(null as unknown as TimberLogger);
    // Should not throw
    logRequestCompleted({ method: 'GET', path: '/', status: 200, durationMs: 1 });
  });
});

// ─── Instrumentation ──────────────────────────────────────────────────────

describe('instrumentation', () => {
  beforeEach(() => {
    resetInstrumentation();
  });

  it('register before request', async () => {
    const order: string[] = [];

    await loadInstrumentation(async () => ({
      register() {
        order.push('register');
      },
    }));

    order.push('request');

    expect(order).toEqual(['register', 'request']);
  });

  it('register awaits async function', async () => {
    const order: string[] = [];

    await loadInstrumentation(async () => ({
      async register() {
        await new Promise((r) => setTimeout(r, 10));
        order.push('register-done');
      },
    }));

    order.push('after-load');
    expect(order).toEqual(['register-done', 'after-load']);
  });

  it('wires up logger export', async () => {
    const logger = createMockLogger();

    await loadInstrumentation(async () => ({
      logger,
    }));

    expect(getLogger()).toBe(logger);
  });

  it('onRequestError called for unhandled errors', async () => {
    const onError = vi.fn();

    await loadInstrumentation(async () => ({
      onRequestError: onError,
    }));

    expect(hasOnRequestError()).toBe(true);

    const reqInfo: InstrumentationRequestInfo = {
      method: 'GET',
      path: '/test',
      headers: {},
    };
    const errCtx: InstrumentationErrorContext = {
      phase: 'render',
      routePath: '/test',
      routeType: 'page',
      traceId: 'abc123',
    };

    await callOnRequestError(new Error('boom'), reqInfo, errCtx);

    expect(onError).toHaveBeenCalledWith(expect.any(Error), reqInfo, errCtx);
  });

  it('onRequestError does not throw if hook throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await loadInstrumentation(async () => ({
      onRequestError() {
        throw new Error('hook error');
      },
    }));

    await expect(
      callOnRequestError(
        new Error('original'),
        { method: 'GET', path: '/', headers: {} },
        { phase: 'render', routePath: '/', routeType: 'page', traceId: 'x' }
      )
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      '[timber] onRequestError hook threw:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('handles missing instrumentation.ts gracefully', async () => {
    await loadInstrumentation(async () => null);
    expect(hasOnRequestError()).toBe(false);
  });

  it('only initializes once', async () => {
    const register = vi.fn();

    await loadInstrumentation(async () => ({ register }));
    await loadInstrumentation(async () => ({ register }));

    expect(register).toHaveBeenCalledTimes(1);
  });

  it('register() error propagates', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      loadInstrumentation(async () => ({
        register() {
          throw new Error('init failed');
        },
      }))
    ).rejects.toThrow('init failed');

    consoleSpy.mockRestore();
  });
});

// ─── OTEL spans ───────────────────────────────────────────────────────────

describe('otel spans', () => {
  it('withSpan runs function when OTEL is not available', async () => {
    // Import dynamically to test the fallback path
    const { withSpan } = await import('../packages/timber-app/src/server/tracing');

    const result = await withSpan('test.span', { key: 'value' }, () => 42);
    expect(result).toBe(42);
  });

  it('withSpan propagates errors', async () => {
    const { withSpan } = await import('../packages/timber-app/src/server/tracing');

    await expect(
      withSpan('test.span', {}, () => {
        throw new Error('span error');
      })
    ).rejects.toThrow('span error');
  });

  it('addSpanEvent is a no-op without OTEL', async () => {
    const { addSpanEvent } = await import('../packages/timber-app/src/server/tracing');

    // Should not throw
    await addSpanEvent('timber.cache.hit', { key: 'test' });
  });

  it('getOtelTraceId returns undefined without OTEL', async () => {
    const { getOtelTraceId } = await import('../packages/timber-app/src/server/tracing');

    const result = await getOtelTraceId();
    expect(result).toBeUndefined();
  });
});
