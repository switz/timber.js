/**
 * Phase 2 Integration Tests — Trace ID
 *
 * Tests that traceId() is accessible and consistent across all pipeline phases:
 *   proxy → middleware → render → action → revalidation
 *
 * Also tests instrumentation.ts integration with tracing and logging.
 *
 * Acceptance criteria from timber-dch.1.6: "traceId accessible in all phases"
 *
 * Ported from acceptance criteria in timber-dch.1.6.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  traceId,
  generateTraceId,
  runWithTraceId,
  replaceTraceId,
} from '../../packages/timber-app/src/server/tracing';
import {
  setLogger,
  getLogger,
  logRequestCompleted,
  logRequestReceived,
  logMiddlewareError,
  logRenderError,
  type TimberLogger,
} from '../../packages/timber-app/src/server/logger';
import {
  loadInstrumentation,
  callOnRequestError,
  resetInstrumentation,
} from '../../packages/timber-app/src/server/instrumentation';
import { createPipeline } from '../../packages/timber-app/src/server/pipeline';
import { createActionClient } from '../../packages/timber-app/src/server/action-client';
import {
  revalidatePath,
  executeAction,
  _clearRevalidationState,
} from '../../packages/timber-app/src/server/actions';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

function createMockLogger(): TimberLogger & Record<string, ReturnType<typeof vi.fn>> {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ─── Trace ID Accessible in All Phases ──────────────────────────────────────

describe('trace id', () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    setLogger(logger);
    resetInstrumentation();
    _clearRevalidationState();
  });

  afterEach(() => {
    setLogger(null as unknown as TimberLogger);
  });

  it('traceId consistent across proxy → middleware → render pipeline', async () => {
    const capturedTraceIds: string[] = [];

    const handler = createPipeline({
      proxy: async (req, next) => {
        const id = generateTraceId();
        return runWithTraceId(id, async () => {
          capturedTraceIds.push(traceId());
          return next();
        });
      },
      matchRoute: () => ({
        segments: [],
        params: {},
        middleware: async () => {
          capturedTraceIds.push(traceId());
        },
      }),
      render: () => {
        capturedTraceIds.push(traceId());
        return new Response('OK');
      },
    });

    await handler(makeRequest('/test'));

    expect(capturedTraceIds).toHaveLength(3);
    expect(capturedTraceIds[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(capturedTraceIds[1]).toBe(capturedTraceIds[0]);
    expect(capturedTraceIds[2]).toBe(capturedTraceIds[0]);
  });

  it('traceId injected into log events across phases', () => {
    const id = generateTraceId();

    runWithTraceId(id, () => {
      logRequestReceived({ method: 'GET', path: '/dashboard' });
      logRequestCompleted({ method: 'GET', path: '/dashboard', status: 200, durationMs: 42 });
      logMiddlewareError({ method: 'GET', path: '/dashboard', error: new Error('fail') });
      logRenderError({ method: 'GET', path: '/dashboard', error: new Error('render') });

      expect(logger.debug).toHaveBeenCalledWith(
        'request received',
        expect.objectContaining({ trace_id: id })
      );
      expect(logger.info).toHaveBeenCalledWith(
        'request completed',
        expect.objectContaining({ trace_id: id })
      );
      expect(logger.error).toHaveBeenCalledWith(
        'unhandled error in middleware phase',
        expect.objectContaining({ trace_id: id })
      );
      expect(logger.error).toHaveBeenCalledWith(
        'unhandled render-phase error',
        expect.objectContaining({ trace_id: id })
      );
    });
  });

  it('traceId + spanId included in log events when OTEL replaces IDs', () => {
    const fallbackId = generateTraceId();
    const otelTraceId = 'abcdef1234567890abcdef1234567890';
    const otelSpanId = '1234567890abcdef';

    runWithTraceId(fallbackId, () => {
      replaceTraceId(otelTraceId, otelSpanId);

      logRequestCompleted({ method: 'GET', path: '/', status: 200, durationMs: 10 });

      expect(logger.info).toHaveBeenCalledWith(
        'request completed',
        expect.objectContaining({
          trace_id: otelTraceId,
          span_id: otelSpanId,
        })
      );
    });
  });

  it('concurrent requests have isolated trace IDs', async () => {
    const ids: string[] = [];

    const handler = createPipeline({
      matchRoute: () => ({
        segments: [],
        params: {},
      }),
      render: () => {
        ids.push(traceId());
        return new Response('OK');
      },
    });

    const promises = Array.from({ length: 10 }, () => {
      const id = generateTraceId();
      return runWithTraceId(id, () => handler(makeRequest('/test')));
    });

    await Promise.all(promises);

    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it('instrumentation.ts onRequestError receives trace context', async () => {
    const onError = vi.fn();

    await loadInstrumentation(async () => ({
      onRequestError: onError,
    }));

    const id = generateTraceId();
    await runWithTraceId(id, async () => {
      await callOnRequestError(
        new Error('test error'),
        { method: 'GET', path: '/test', headers: {} },
        { phase: 'render', routePath: '/test', routeType: 'page', traceId: id }
      );
    });

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ method: 'GET', path: '/test' }),
      expect.objectContaining({ traceId: id, phase: 'render' })
    );
  });

  it('instrumentation.ts logger wiring integrates with trace context', async () => {
    const customLogger = createMockLogger();

    await loadInstrumentation(async () => ({
      logger: customLogger,
    }));

    expect(getLogger()).toBe(customLogger);

    const id = generateTraceId();
    runWithTraceId(id, () => {
      logRequestCompleted({ method: 'POST', path: '/action', status: 200, durationMs: 55 });
    });

    expect(customLogger.info).toHaveBeenCalledWith(
      'request completed',
      expect.objectContaining({
        trace_id: id,
        method: 'POST',
        path: '/action',
      })
    );
  });

  it('trace ID preserved across action + revalidation', async () => {
    const capturedTraceIds: string[] = [];
    const id = generateTraceId();

    const renderer = vi.fn(async (path: string) => {
      capturedTraceIds.push(traceId());
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`RSC for ${path}`));
          controller.close();
        },
      });
    });

    const client = createActionClient();
    const myAction = client.action(async () => {
      capturedTraceIds.push(traceId());
      revalidatePath('/dashboard');
      return { ok: true };
    });

    await runWithTraceId(id, async () => {
      await executeAction(async () => myAction(), [], { renderer });
    });

    expect(capturedTraceIds).toHaveLength(2);
    expect(capturedTraceIds[0]).toBe(id);
    expect(capturedTraceIds[1]).toBe(id);
  });
});
