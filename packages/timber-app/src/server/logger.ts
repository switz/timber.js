/**
 * Logger — structured logging with environment-aware formatting.
 *
 * timber.js does not ship a logger. Users export any object with
 * info/warn/error/debug methods from instrumentation.ts and the framework
 * picks it up. Silent if no logger export is present.
 *
 * See design/17-logging.md §"Production Logging"
 */

import { getTraceStore } from './tracing.js';

// ─── Logger Interface ─────────────────────────────────────────────────────

/** Any object with standard log methods satisfies this — pino, winston, consola, console. */
export interface TimberLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
}

// ─── Logger Registry ──────────────────────────────────────────────────────

let _logger: TimberLogger | null = null;

/**
 * Set the user-provided logger. Called by the instrumentation loader
 * when it finds a `logger` export in instrumentation.ts.
 */
export function setLogger(logger: TimberLogger): void {
  _logger = logger;
}

/**
 * Get the current logger, or null if none configured.
 * Framework-internal — used at framework event points to emit structured logs.
 */
export function getLogger(): TimberLogger | null {
  return _logger;
}

// ─── Framework Log Helpers ────────────────────────────────────────────────

/**
 * Inject trace_id and span_id into log data for log–trace correlation.
 * Always injects trace_id (never undefined). Injects span_id only when OTEL is active.
 */
function withTraceContext(data?: Record<string, unknown>): Record<string, unknown> {
  const store = getTraceStore();
  const enriched: Record<string, unknown> = { ...data };
  if (store) {
    enriched.trace_id = store.traceId;
    if (store.spanId) {
      enriched.span_id = store.spanId;
    }
  }
  return enriched;
}

// ─── Framework Event Emitters ─────────────────────────────────────────────

/** Log a completed request. Level: info. */
export function logRequestCompleted(data: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}): void {
  _logger?.info('request completed', withTraceContext(data));
}

/** Log request received. Level: debug. */
export function logRequestReceived(data: { method: string; path: string }): void {
  _logger?.debug('request received', withTraceContext(data));
}

/** Log a slow request warning. Level: warn. */
export function logSlowRequest(data: {
  method: string;
  path: string;
  durationMs: number;
  threshold: number;
}): void {
  _logger?.warn('slow request exceeded threshold', withTraceContext(data));
}

/** Log middleware short-circuit. Level: debug. */
export function logMiddlewareShortCircuit(data: {
  method: string;
  path: string;
  status: number;
}): void {
  _logger?.debug('middleware short-circuited', withTraceContext(data));
}

/** Log unhandled error in middleware phase. Level: error. */
export function logMiddlewareError(data: { method: string; path: string; error: unknown }): void {
  if (_logger) {
    _logger.error('unhandled error in middleware phase', withTraceContext(data));
  } else if (process.env.NODE_ENV !== 'production') {
    console.error('[timber] middleware error', data.error);
  }
}

/** Log unhandled render-phase error. Level: error. */
export function logRenderError(data: { method: string; path: string; error: unknown }): void {
  if (_logger) {
    _logger.error('unhandled render-phase error', withTraceContext(data));
  } else if (process.env.NODE_ENV !== 'production') {
    // No logger configured — fall back to console.error in dev so errors are visible.
    console.error('[timber] render error', data.error);
  }
}

/** Log proxy.ts uncaught error. Level: error. */
export function logProxyError(data: { error: unknown }): void {
  if (_logger) {
    _logger.error('proxy.ts threw uncaught error', withTraceContext(data));
  } else if (process.env.NODE_ENV !== 'production') {
    console.error('[timber] proxy error', data.error);
  }
}

/** Log waitUntil() adapter missing (once at startup). Level: warn. */
export function logWaitUntilUnsupported(): void {
  _logger?.warn('adapter does not support waitUntil()');
}

/** Log waitUntil() promise rejection. Level: warn. */
export function logWaitUntilRejected(data: { error: unknown }): void {
  _logger?.warn('waitUntil() promise rejected', withTraceContext(data));
}

/** Log staleWhileRevalidate refetch failure. Level: warn. */
export function logSwrRefetchFailed(data: { cacheKey: string; error: unknown }): void {
  _logger?.warn('staleWhileRevalidate refetch failed', withTraceContext(data));
}

/** Log cache miss. Level: debug. */
export function logCacheMiss(data: { cacheKey: string }): void {
  _logger?.debug('timber.cache MISS', withTraceContext(data));
}
