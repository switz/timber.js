/**
 * Tracing — per-request trace ID via AsyncLocalStorage, OTEL span helpers.
 *
 * traceId() is always available in server code (middleware, access, components, actions).
 * Returns a 32-char lowercase hex string — the OTEL trace ID when an SDK is active,
 * or a crypto.randomUUID()-derived fallback otherwise.
 *
 * See design/17-logging.md §"trace_id is Always Set"
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// ─── ALS Store ────────────────────────────────────────────────────────────

export interface TraceStore {
  /** 32-char lowercase hex trace ID (OTEL or UUID fallback). */
  traceId: string;
  /** OTEL span ID if available, undefined otherwise. */
  spanId?: string;
}

const traceAls = new AsyncLocalStorage<TraceStore>();

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Returns the current request's trace ID — always a 32-char lowercase hex string.
 *
 * With OTEL: the real OTEL trace ID (matches Jaeger/Honeycomb/Datadog).
 * Without OTEL: crypto.randomUUID() with hyphens stripped.
 *
 * Throws if called outside a request context (no ALS store).
 */
export function traceId(): string {
  const store = traceAls.getStore();
  if (!store) {
    throw new Error(
      '[timber] traceId() called outside of a request context. ' +
        'It can only be used in middleware, access checks, server components, and server actions.'
    );
  }
  return store.traceId;
}

/**
 * Returns the current OTEL span ID if available, undefined otherwise.
 */
export function spanId(): string | undefined {
  return traceAls.getStore()?.spanId;
}

// ─── Framework-Internal Helpers ───────────────────────────────────────────

/**
 * Generate a 32-char lowercase hex ID from crypto.randomUUID().
 * Same format as OTEL trace IDs — zero-friction upgrade path.
 */
export function generateTraceId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Run a callback within a trace context. Used by the pipeline to establish
 * per-request ALS scope.
 */
export function runWithTraceId<T>(id: string, fn: () => T): T {
  return traceAls.run({ traceId: id }, fn);
}

/**
 * Replace the trace ID in the current ALS store. Used when OTEL creates
 * a root span and we want to switch from the UUID fallback to the real
 * OTEL trace ID.
 */
export function replaceTraceId(newTraceId: string, newSpanId?: string): void {
  const store = traceAls.getStore();
  if (store) {
    store.traceId = newTraceId;
    store.spanId = newSpanId;
  }
}

/**
 * Update the span ID in the current ALS store. Used when entering a new
 * OTEL span to keep log–trace correlation accurate.
 */
export function updateSpanId(newSpanId: string | undefined): void {
  const store = traceAls.getStore();
  if (store) {
    store.spanId = newSpanId;
  }
}

/**
 * Get the current trace store, or undefined if outside a request context.
 * Framework-internal — use traceId()/spanId() in user code.
 */
export function getTraceStore(): TraceStore | undefined {
  return traceAls.getStore();
}

// ─── Dev-Mode OTEL Auto-Init ─────────────────────────────────────────────

/**
 * Initialize a minimal OTEL SDK in dev mode so spans are recorded and
 * fed to the DevSpanProcessor for dev log output.
 *
 * If the user already configured an OTEL SDK in register(), we add
 * our DevSpanProcessor alongside theirs. If no SDK is configured,
 * we create a BasicTracerProvider with our processor.
 *
 * Only called in dev mode — zero overhead in production.
 */
export async function initDevTracing(
  config: import('./dev-logger.js').DevLoggerConfig
): Promise<void> {
  const api = await getOtelApi();
  if (!api) return;

  const { DevSpanProcessor } = await import('./dev-span-processor.js');
  const { BasicTracerProvider } = await import('@opentelemetry/sdk-trace-base');
  const processor = new DevSpanProcessor(config);

  // Create a minimal TracerProvider with our DevSpanProcessor.
  // If the user also configures an SDK in register(), their provider
  // will coexist — the global provider set last wins for new tracers,
  // but our processor captures all spans from the timber.js tracer.
  const provider = new BasicTracerProvider({
    spanProcessors: [processor],
  });
  api.trace.setGlobalTracerProvider(provider);

  // Reset cached tracer so next getTracer() picks up the new provider
  _tracer = undefined;
}

// ─── OTEL Span Helpers ───────────────────────────────────────────────────

/**
 * Attempt to get the @opentelemetry/api tracer. Returns undefined if the
 * package is not installed or no SDK is registered.
 *
 * timber.js depends on @opentelemetry/api as the vendor-neutral interface.
 * The API is a no-op by default — spans are only emitted when the developer
 * initializes an SDK in register().
 */
let _otelApi: typeof import('@opentelemetry/api') | null | undefined;

async function getOtelApi(): Promise<typeof import('@opentelemetry/api') | null> {
  if (_otelApi === undefined) {
    try {
      _otelApi = await import('@opentelemetry/api');
    } catch {
      _otelApi = null;
    }
  }
  return _otelApi;
}

/** OTEL tracer instance, lazily created. */
let _tracer: import('@opentelemetry/api').Tracer | null | undefined;

/**
 * Get the timber.js OTEL tracer. Returns null if @opentelemetry/api is not available.
 */
export async function getTracer(): Promise<import('@opentelemetry/api').Tracer | null> {
  if (_tracer === undefined) {
    const api = await getOtelApi();
    if (api) {
      _tracer = api.trace.getTracer('timber.js');
    } else {
      _tracer = null;
    }
  }
  return _tracer;
}

/**
 * Run a function within an OTEL span. If OTEL is not available, runs the function
 * directly without any span overhead.
 *
 * Automatically:
 * - Creates the span as a child of the current context
 * - Updates the ALS span ID for log–trace correlation
 * - Ends the span when the function completes
 * - Records exceptions on error
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => T | Promise<T>
): Promise<T> {
  const tracer = await getTracer();
  if (!tracer) {
    return fn();
  }

  const api = (await getOtelApi())!;
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    const prevSpanId = spanId();
    updateSpanId(span.spanContext().spanId);
    try {
      const result = await fn();
      span.setStatus({ code: api.SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: api.SpanStatusCode.ERROR });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
      updateSpanId(prevSpanId);
    }
  });
}

/**
 * Set an attribute on the current active span (if any).
 * Used for setting span attributes after span creation (e.g. timber.result on access spans).
 */
export async function setSpanAttribute(
  key: string,
  value: string | number | boolean
): Promise<void> {
  const api = await getOtelApi();
  if (!api) return;

  const activeSpan = api.trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute(key, value);
  }
}

/**
 * Add a span event to the current active span (if any).
 * Used for timber.cache HIT/MISS events — recorded as span events, not child spans.
 */
export async function addSpanEvent(
  name: string,
  attributes?: Record<string, string | number | boolean>
): Promise<void> {
  const api = await getOtelApi();
  if (!api) return;

  const activeSpan = api.trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.addEvent(name, attributes);
  }
}

/**
 * Try to extract the OTEL trace ID from the current active span context.
 * Returns undefined if OTEL is not active or no span exists.
 */
export async function getOtelTraceId(): Promise<{ traceId: string; spanId: string } | undefined> {
  const api = await getOtelApi();
  if (!api) return undefined;

  const activeSpan = api.trace.getActiveSpan();
  if (!activeSpan) return undefined;

  const ctx = activeSpan.spanContext();
  // OTEL uses "0000000000000000" as invalid trace IDs
  if (!ctx.traceId || ctx.traceId === '00000000000000000000000000000000') {
    return undefined;
  }

  return { traceId: ctx.traceId, spanId: ctx.spanId };
}
