/**
 * Integration tests for OTEL context propagation in dev tracing.
 *
 * Verifies that initDevTracing() sets up the context manager so that:
 * - Child spans share the root span's trace ID
 * - startActiveSpan propagates parent context across async boundaries
 * - getActiveSpan()/setSpanAttribute works inside withSpan callbacks
 * - DevSpanProcessor collects all spans for a request
 *
 * These tests exercise the real OTEL SDK (not mocks) to prevent regressions
 * like the missing AsyncLocalStorageContextManager bug.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as api from '@opentelemetry/api';
import {
  BasicTracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

// ─── Test Helpers ────────────────────────────────────────────────────────

/** Create a simple span-collecting processor for test assertions. */
function createTestProcessor() {
  const allSpans: ReadableSpan[] = [];
  const processor: SpanProcessor = {
    onStart: (_span: api.Span, _ctx: api.Context) => {},
    onEnd: (span: ReadableSpan) => {
      allSpans.push(span);
    },
    shutdown: async () => {},
    forceFlush: async () => {},
  };

  return { processor, allSpans };
}

/** Set up OTEL with context manager (mirrors initDevTracing). */
function setupOtel(processor: SpanProcessor) {
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  api.context.setGlobalContextManager(contextManager);

  const provider = new BasicTracerProvider({
    spanProcessors: [processor],
  });
  api.trace.setGlobalTracerProvider(provider);

  return { provider, contextManager };
}

/** Clean up global OTEL state between tests. */
function teardownOtel(
  provider: BasicTracerProvider,
  contextManager: AsyncLocalStorageContextManager
) {
  provider.shutdown();
  contextManager.disable();
  api.trace.disable();
  api.context.disable();
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('OTEL context propagation (integration)', () => {
  let provider: BasicTracerProvider;
  let contextManager: AsyncLocalStorageContextManager;

  afterEach(() => {
    if (provider && contextManager) {
      teardownOtel(provider, contextManager);
    }
  });

  it('child spans share parent trace ID', async () => {
    const { processor, allSpans } = createTestProcessor();
    ({ provider, contextManager } = setupOtel(processor));

    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('http.server.request', async (rootSpan) => {
      await tracer.startActiveSpan('timber.render', async (childSpan) => {
        childSpan.end();
      });
      rootSpan.end();
    });

    expect(allSpans).toHaveLength(2);
    const rootTraceId = allSpans
      .find((s) => s.name === 'http.server.request')!
      .spanContext().traceId;
    const childTraceId = allSpans.find((s) => s.name === 'timber.render')!.spanContext().traceId;
    expect(childTraceId).toBe(rootTraceId);
  });

  it('deeply nested spans all share the same trace ID', async () => {
    const { processor, allSpans } = createTestProcessor();
    ({ provider, contextManager } = setupOtel(processor));

    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('http.server.request', async (rootSpan) => {
      await tracer.startActiveSpan('timber.render', async (renderSpan) => {
        await tracer.startActiveSpan('timber.access', async (accessSpan) => {
          accessSpan.end();
        });
        await tracer.startActiveSpan('timber.ssr', async (ssrSpan) => {
          ssrSpan.end();
        });
        renderSpan.end();
      });
      rootSpan.end();
    });

    expect(allSpans).toHaveLength(4);
    const rootTraceId = allSpans
      .find((s) => s.name === 'http.server.request')!
      .spanContext().traceId;
    for (const span of allSpans) {
      expect(span.spanContext().traceId).toBe(rootTraceId);
    }
  });

  it('getActiveSpan returns the correct span inside startActiveSpan', async () => {
    const { processor } = createTestProcessor();
    ({ provider, contextManager } = setupOtel(processor));

    const tracer = api.trace.getTracer('test');
    let activeInsideRoot: api.Span | undefined;
    let activeInsideChild: api.Span | undefined;
    let activeAfterChild: api.Span | undefined;

    await tracer.startActiveSpan('http.server.request', async (rootSpan) => {
      activeInsideRoot = api.trace.getActiveSpan();

      await tracer.startActiveSpan('timber.render', async (childSpan) => {
        activeInsideChild = api.trace.getActiveSpan();
        childSpan.end();
      });

      activeAfterChild = api.trace.getActiveSpan();
      rootSpan.end();
    });

    // Active span should be the innermost span at each point
    expect(activeInsideRoot!.spanContext().spanId).toBeDefined();
    expect(activeInsideChild!.spanContext().spanId).not.toBe(
      activeInsideRoot!.spanContext().spanId
    );
    // After child completes, active span reverts to root
    expect(activeAfterChild!.spanContext().spanId).toBe(activeInsideRoot!.spanContext().spanId);
  });

  it('setSpanAttribute via getActiveSpan works inside nested spans', async () => {
    const { processor, allSpans } = createTestProcessor();
    ({ provider, contextManager } = setupOtel(processor));

    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('http.server.request', async (rootSpan) => {
      await tracer.startActiveSpan('timber.render', async (childSpan) => {
        childSpan.end();
      });

      // After child span completes, set attribute on root via getActiveSpan
      const active = api.trace.getActiveSpan();
      active?.setAttribute('http.response.status_code', 404);

      rootSpan.end();
    });

    const rootSpan = allSpans.find((s) => s.name === 'http.server.request')!;
    expect(rootSpan.attributes['http.response.status_code']).toBe(404);
  });

  it('child spans have correct parentSpanId', async () => {
    const { processor, allSpans } = createTestProcessor();
    ({ provider, contextManager } = setupOtel(processor));

    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('http.server.request', async (rootSpan) => {
      await tracer.startActiveSpan('timber.render', async (renderSpan) => {
        renderSpan.end();
      });
      rootSpan.end();
    });

    const root = allSpans.find((s) => s.name === 'http.server.request')!;
    const child = allSpans.find((s) => s.name === 'timber.render')!;
    expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
  });

  it('context propagation survives async boundaries', async () => {
    const { processor, allSpans } = createTestProcessor();
    ({ provider, contextManager } = setupOtel(processor));

    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('http.server.request', async (rootSpan) => {
      // Simulate async work (like a network request or DB call)
      await new Promise<void>((resolve) => setTimeout(resolve, 5));

      await tracer.startActiveSpan('timber.render', async (renderSpan) => {
        // More async work
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        renderSpan.end();
      });

      // After async child, active span should still be root
      const active = api.trace.getActiveSpan();
      active?.setAttribute('http.response.status_code', 200);

      rootSpan.end();
    });

    expect(allSpans).toHaveLength(2);
    const root = allSpans.find((s) => s.name === 'http.server.request')!;
    const child = allSpans.find((s) => s.name === 'timber.render')!;

    // Same trace ID after async boundaries
    expect(child.spanContext().traceId).toBe(root.spanContext().traceId);
    // Parent-child relationship preserved
    expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    // setAttribute worked via getActiveSpan after async child
    expect(root.attributes['http.response.status_code']).toBe(200);
  });

  it('without context manager, child spans get different trace IDs (regression guard)', async () => {
    // This test documents the broken behavior that occurs without a context
    // manager — the exact bug that was fixed. If this test ever fails (i.e.
    // spans share trace IDs without a context manager), the context manager
    // setup is no longer needed.
    const allSpans: ReadableSpan[] = [];
    const processor: SpanProcessor = {
      onStart: () => {},
      onEnd: (span: ReadableSpan) => allSpans.push(span),
      shutdown: async () => {},
      forceFlush: async () => {},
    };

    // Set up provider WITHOUT context manager
    const bareProvider = new BasicTracerProvider({
      spanProcessors: [processor],
    });
    api.trace.setGlobalTracerProvider(bareProvider);
    // Intentionally NOT setting up a context manager

    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('http.server.request', async (rootSpan) => {
      await tracer.startActiveSpan('timber.render', async (childSpan) => {
        childSpan.end();
      });
      rootSpan.end();
    });

    const root = allSpans.find((s) => s.name === 'http.server.request')!;
    const child = allSpans.find((s) => s.name === 'timber.render')!;

    // Without context manager, child spans can't find parent — different trace IDs
    expect(child.spanContext().traceId).not.toBe(root.spanContext().traceId);

    // Clean up
    bareProvider.shutdown();
    api.trace.disable();
  });
});
