import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPipeline,
  type PipelineConfig,
  type RouteMatch,
} from '../packages/timber-app/src/server/pipeline';
import type { MiddlewareFn } from '../packages/timber-app/src/server/middleware-runner';
import { setLogger, type TimberLogger } from '../packages/timber-app/src/server/logger';
import { traceId } from '../packages/timber-app/src/server/tracing';
import {
  resetInstrumentation,
  loadInstrumentation,
} from '../packages/timber-app/src/server/instrumentation';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

function makeMatch(overrides?: Partial<RouteMatch>): RouteMatch {
  return {
    segments: [],
    params: {},
    ...overrides,
  };
}

function okRender(): PipelineConfig['render'] {
  return () => new Response('OK', { status: 200 });
}

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    matchRoute: () => makeMatch(),
    render: okRender(),
    ...overrides,
  };
}

function createMockLogger() {
  return {
    info: vi.fn<TimberLogger['info']>(),
    warn: vi.fn<TimberLogger['warn']>(),
    error: vi.fn<TimberLogger['error']>(),
    debug: vi.fn<TimberLogger['debug']>(),
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────

let mockLogger: ReturnType<typeof createMockLogger>;

beforeEach(() => {
  mockLogger = createMockLogger();
  setLogger(mockLogger);
  resetInstrumentation();
});

afterEach(() => {
  setLogger(null as unknown as TimberLogger);
  resetInstrumentation();
});

// ─── Trace ID ─────────────────────────────────────────────────────────────

describe('trace ID established', () => {
  it('traceId() is available inside proxy.ts', async () => {
    let capturedTraceId: string | undefined;

    const handler = createPipeline(
      makeConfig({
        proxy: async (_req, next) => {
          capturedTraceId = traceId();
          return next();
        },
      })
    );

    await handler(makeRequest('/test'));
    expect(capturedTraceId).toBeDefined();
    expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('traceId() is available inside middleware', async () => {
    let capturedTraceId: string | undefined;

    const middlewareFn: MiddlewareFn = async () => {
      capturedTraceId = traceId();
    };

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
      })
    );

    await handler(makeRequest('/test'));
    expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('traceId() is available inside render', async () => {
    let capturedTraceId: string | undefined;

    const handler = createPipeline(
      makeConfig({
        render: () => {
          capturedTraceId = traceId();
          return new Response('OK');
        },
      })
    );

    await handler(makeRequest('/test'));
    expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('different requests get different trace IDs', async () => {
    const traceIds: string[] = [];

    const handler = createPipeline(
      makeConfig({
        render: () => {
          traceIds.push(traceId());
          return new Response('OK');
        },
      })
    );

    await handler(makeRequest('/a'));
    await handler(makeRequest('/b'));
    expect(traceIds).toHaveLength(2);
    expect(traceIds[0]).not.toBe(traceIds[1]);
  });
});

// ─── Request Logging ──────────────────────────────────────────────────────

describe('request received', () => {
  it('logRequestReceived called at request start', async () => {
    const handler = createPipeline(makeConfig());
    await handler(makeRequest('/hello'));

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'request received',
      expect.objectContaining({ method: 'GET', path: '/hello' })
    );
  });

  it('includes trace_id in log data', async () => {
    const handler = createPipeline(makeConfig());
    await handler(makeRequest('/test'));

    const call = mockLogger.debug.mock.calls.find((c: unknown[]) => c[0] === 'request received');
    expect(call).toBeDefined();
    expect((call![1] as Record<string, unknown>).trace_id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('request completed', () => {
  it('logRequestCompleted called with method, path, status, durationMs', async () => {
    const handler = createPipeline(makeConfig());
    await handler(makeRequest('/test'));

    expect(mockLogger.info).toHaveBeenCalledWith(
      'request completed',
      expect.objectContaining({
        method: 'GET',
        path: '/test',
        status: 200,
        durationMs: expect.any(Number),
      })
    );
  });

  it('status reflects the actual response status', async () => {
    const handler = createPipeline(
      makeConfig({
        matchRoute: () => null,
      })
    );

    await handler(makeRequest('/notfound'));

    const call = mockLogger.info.mock.calls.find((c: unknown[]) => c[0] === 'request completed');
    expect((call![1] as Record<string, unknown>).status).toBe(404);
  });

  it('durationMs is a non-negative number', async () => {
    const handler = createPipeline(makeConfig());
    await handler(makeRequest('/test'));

    const call = mockLogger.info.mock.calls.find((c: unknown[]) => c[0] === 'request completed');
    expect((call![1] as Record<string, unknown>).durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('slow request', () => {
  it('logSlowRequest called when durationMs exceeds threshold', async () => {
    const handler = createPipeline(
      makeConfig({
        slowRequestMs: 1, // 1ms threshold — any real request exceeds this
        render: async () => {
          // Introduce a small delay to guarantee exceeding 1ms
          await new Promise((r) => setTimeout(r, 5));
          return new Response('OK');
        },
      })
    );

    await handler(makeRequest('/slow'));

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'slow request exceeded threshold',
      expect.objectContaining({
        method: 'GET',
        path: '/slow',
        durationMs: expect.any(Number),
        threshold: 1,
      })
    );
  });

  it('logSlowRequest not called when slowRequestMs is 0 (disabled)', async () => {
    const handler = createPipeline(
      makeConfig({
        slowRequestMs: 0,
        render: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return new Response('OK');
        },
      })
    );

    await handler(makeRequest('/test'));

    const slowCalls = mockLogger.warn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'slow request exceeded threshold'
    );
    expect(slowCalls).toHaveLength(0);
  });

  it('logSlowRequest not called for fast requests', async () => {
    const handler = createPipeline(
      makeConfig({
        slowRequestMs: 60000, // 60 second threshold — won't be exceeded
      })
    );

    await handler(makeRequest('/fast'));

    const slowCalls = mockLogger.warn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'slow request exceeded threshold'
    );
    expect(slowCalls).toHaveLength(0);
  });
});

// ─── Error Logging ────────────────────────────────────────────────────────

describe('proxy error', () => {
  it('logProxyError called on proxy.ts throw', async () => {
    const handler = createPipeline(
      makeConfig({
        proxy: async () => {
          throw new Error('proxy crash');
        },
      })
    );

    await handler(makeRequest('/test'));

    expect(mockLogger.error).toHaveBeenCalledWith(
      'proxy.ts threw uncaught error',
      expect.objectContaining({
        error: expect.any(Error),
        trace_id: expect.stringMatching(/^[0-9a-f]{32}$/),
      })
    );
  });

  it('returns 500 on proxy error', async () => {
    const handler = createPipeline(
      makeConfig({
        proxy: async () => {
          throw new Error('proxy crash');
        },
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(500);
  });
});

describe('middleware error', () => {
  it('logMiddlewareError called on middleware throw', async () => {
    const middlewareFn: MiddlewareFn = async () => {
      throw new Error('middleware crash');
    };

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
      })
    );

    await handler(makeRequest('/test'));

    expect(mockLogger.error).toHaveBeenCalledWith(
      'unhandled error in middleware phase',
      expect.objectContaining({
        method: 'GET',
        path: '/test',
        error: expect.any(Error),
      })
    );
  });
});

describe('middleware short-circuit', () => {
  it('logMiddlewareShortCircuit called when middleware returns Response', async () => {
    const middlewareFn: MiddlewareFn = async () => {
      return new Response('blocked', { status: 403 });
    };

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
      })
    );

    await handler(makeRequest('/test'));

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'middleware short-circuited',
      expect.objectContaining({
        method: 'GET',
        path: '/test',
        status: 403,
      })
    );
  });
});

describe('render error', () => {
  it('logRenderError called on render throw', async () => {
    const handler = createPipeline(
      makeConfig({
        render: () => {
          throw new Error('render crash');
        },
      })
    );

    await handler(makeRequest('/test'));

    expect(mockLogger.error).toHaveBeenCalledWith(
      'unhandled render-phase error',
      expect.objectContaining({
        method: 'GET',
        path: '/test',
        error: expect.any(Error),
      })
    );
  });

  it('returns 500 on render error', async () => {
    const handler = createPipeline(
      makeConfig({
        render: () => {
          throw new Error('render crash');
        },
      })
    );

    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(500);
  });

  it('request completed log still fires after render error', async () => {
    const handler = createPipeline(
      makeConfig({
        render: () => {
          throw new Error('render crash');
        },
      })
    );

    await handler(makeRequest('/test'));

    const completedCall = mockLogger.info.mock.calls.find(
      (c: unknown[]) => c[0] === 'request completed'
    );
    expect(completedCall).toBeDefined();
    expect((completedCall![1] as Record<string, unknown>).status).toBe(500);
  });
});

// ─── onRequestError ──────────────────────────────────────────────────────

describe('onRequestError', () => {
  it('called for proxy errors', async () => {
    const errorHook = vi.fn();
    resetInstrumentation();
    await loadInstrumentation(async () => ({
      onRequestError: errorHook,
      logger: mockLogger,
    }));

    const handler = createPipeline(
      makeConfig({
        proxy: async () => {
          throw new Error('proxy crash');
        },
      })
    );

    await handler(makeRequest('/test'));

    expect(errorHook).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ method: 'GET', path: '/test' }),
      expect.objectContaining({ phase: 'proxy', traceId: expect.stringMatching(/^[0-9a-f]{32}$/) })
    );
  });

  it('called for middleware errors', async () => {
    const errorHook = vi.fn();
    resetInstrumentation();
    await loadInstrumentation(async () => ({
      onRequestError: errorHook,
      logger: mockLogger,
    }));

    const middlewareFn: MiddlewareFn = async () => {
      throw new Error('middleware crash');
    };

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
      })
    );

    await handler(makeRequest('/test'));

    expect(errorHook).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ method: 'GET', path: '/test' }),
      expect.objectContaining({ phase: 'handler' })
    );
  });

  it('called for render errors', async () => {
    const errorHook = vi.fn();
    resetInstrumentation();
    await loadInstrumentation(async () => ({
      onRequestError: errorHook,
      logger: mockLogger,
    }));

    const handler = createPipeline(
      makeConfig({
        render: () => {
          throw new Error('render crash');
        },
      })
    );

    await handler(makeRequest('/test'));

    expect(errorHook).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ method: 'GET', path: '/test' }),
      expect.objectContaining({ phase: 'render' })
    );
  });

  it('error hook failure does not affect response', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetInstrumentation();
    await loadInstrumentation(async () => ({
      onRequestError: () => {
        throw new Error('hook itself crashed');
      },
      logger: mockLogger,
    }));

    const handler = createPipeline(
      makeConfig({
        render: () => {
          throw new Error('render crash');
        },
      })
    );

    const res = await handler(makeRequest('/test'));
    // Response should still be 500 even though the hook also threw
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});

// ─── OTEL Spans ──────────────────────────────────────────────────────────

describe('OTEL spans', () => {
  it('withSpan wraps the full request lifecycle', async () => {
    // Without a real OTEL SDK, withSpan is a no-op — but it still runs
    // the function. We verify by confirming the pipeline still works.
    const handler = createPipeline(makeConfig());
    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(200);
  });

  it('withSpan wraps proxy phase', async () => {
    const order: string[] = [];
    const handler = createPipeline(
      makeConfig({
        proxy: async (_req, next) => {
          order.push('proxy');
          return next();
        },
        render: () => {
          order.push('render');
          return new Response('OK');
        },
      })
    );

    await handler(makeRequest('/test'));
    // Verify execution order is preserved through withSpan wrapping
    expect(order).toEqual(['proxy', 'render']);
  });

  it('withSpan wraps middleware phase', async () => {
    const order: string[] = [];
    const middlewareFn: MiddlewareFn = async () => {
      order.push('middleware');
    };

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
        render: () => {
          order.push('render');
          return new Response('OK');
        },
      })
    );

    await handler(makeRequest('/test'));
    expect(order).toEqual(['middleware', 'render']);
  });

  it('withSpan wraps render phase', async () => {
    let renderCalled = false;
    const handler = createPipeline(
      makeConfig({
        render: () => {
          renderCalled = true;
          return new Response('OK');
        },
      })
    );

    await handler(makeRequest('/test'));
    expect(renderCalled).toBe(true);
  });
});

// ─── No console.error ────────────────────────────────────────────────────

describe('no console.error in pipeline', () => {
  it('proxy error uses structured logger, not console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = createPipeline(
      makeConfig({
        proxy: async () => {
          throw new Error('proxy crash');
        },
      })
    );

    await handler(makeRequest('/test'));

    // Structured logger should have been called
    expect(mockLogger.error).toHaveBeenCalled();

    // console.error should NOT have been called by the pipeline
    // (it may be called by callOnRequestError if the hook throws,
    // but not by the pipeline itself for the original error)
    const pipelineCalls = errorSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[timber] Uncaught error')
    );
    expect(pipelineCalls).toHaveLength(0);

    errorSpy.mockRestore();
  });

  it('middleware error uses structured logger, not console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const middlewareFn: MiddlewareFn = async () => {
      throw new Error('middleware crash');
    };

    const handler = createPipeline(
      makeConfig({
        matchRoute: () => makeMatch({ middleware: middlewareFn }),
      })
    );

    await handler(makeRequest('/test'));

    expect(mockLogger.error).toHaveBeenCalled();

    const pipelineCalls = errorSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('[timber] Uncaught error')
    );
    expect(pipelineCalls).toHaveLength(0);

    errorSpy.mockRestore();
  });
});

// ─── Logging without a logger configured ─────────────────────────────────

describe('silent when no logger', () => {
  it('pipeline works without any logger configured', async () => {
    setLogger(null as unknown as TimberLogger);

    const handler = createPipeline(makeConfig());
    const res = await handler(makeRequest('/test'));
    expect(res.status).toBe(200);
  });
});
