/**
 * Request pipeline — the central dispatch for all timber.js requests.
 *
 * Pipeline stages (in order):
 *   proxy.ts → canonicalize → route match → 103 Early Hints → middleware.ts → render
 *
 * Each stage is a pure function or returns a Response to short-circuit.
 * Each request gets a trace ID, structured logging, and OTEL spans.
 *
 * See design/07-routing.md §"Request Lifecycle", design/02-rendering-pipeline.md §"Request Flow",
 * and design/17-logging.md §"Production Logging"
 */

import { canonicalize } from './canonicalize.js';
import { runProxy, type ProxyExport } from './proxy.js';
import { runMiddleware, type MiddlewareFn } from './middleware-runner.js';
import { runWithRequestContext, applyRequestHeaderOverlay } from './request-context.js';
import {
  generateTraceId,
  runWithTraceId,
  getOtelTraceId,
  replaceTraceId,
  withSpan,
  traceId,
} from './tracing.js';
import {
  logRequestReceived,
  logRequestCompleted,
  logSlowRequest,
  logProxyError,
  logMiddlewareError,
  logMiddlewareShortCircuit,
  logRenderError,
} from './logger.js';
import { callOnRequestError } from './instrumentation.js';
import { DevLogEmitter } from './dev-log-events.js';
import { runWithDevLog } from './dev-log-context.js';
import type { MiddlewareContext } from './types.js';
import type { SegmentNode } from '../routing/types.js';

// ─── Route Match Result ────────────────────────────────────────────────────

/** Result of matching a canonical pathname against the route tree. */
export interface RouteMatch {
  /** The matched segment chain from root to leaf. */
  segments: SegmentNode[];
  /** Extracted route params. */
  params: Record<string, string>;
  /** The leaf segment's middleware.ts export, if any. */
  middleware?: MiddlewareFn;
}

/** Function that matches a canonical pathname to a route. */
export type RouteMatcher = (pathname: string) => RouteMatch | null;

/** Function that renders a matched route into a Response. */
export type RouteRenderer = (
  req: Request,
  match: RouteMatch,
  responseHeaders: Headers,
  requestHeaderOverlay: Headers
) => Response | Promise<Response>;

/** Function that sends 103 Early Hints for a matched route. */
export type EarlyHintsEmitter = (match: RouteMatch, req: Request) => void | Promise<void>;

// ─── Pipeline Configuration ────────────────────────────────────────────────

export interface PipelineConfig {
  /** The proxy.ts default export (function or array). Undefined if no proxy.ts. */
  proxy?: ProxyExport;
  /** Route matcher — resolves a canonical pathname to a RouteMatch. */
  matchRoute: RouteMatcher;
  /** Renderer — produces the final Response for a matched route. */
  render: RouteRenderer;
  /** Renderer for no-match 404 — renders 404.tsx in root layout. */
  renderNoMatch?: (req: Request, responseHeaders: Headers) => Response | Promise<Response>;
  /** Early hints emitter — fires 103 hints after route match, before middleware. */
  earlyHints?: EarlyHintsEmitter;
  /** Whether to strip trailing slashes during canonicalization. Default: true. */
  stripTrailingSlash?: boolean;
  /** Slow request threshold in ms. Requests exceeding this emit a warning. 0 to disable. Default: 3000. */
  slowRequestMs?: number;
  /**
   * Dev log callback — called per-request with a DevLogEmitter in dev mode.
   * The pipeline creates the emitter, emits events at each phase, and
   * calls this callback with the emitter so the dev server can subscribe
   * a collector and format output.
   *
   * Undefined in production — no emitter is created, zero overhead.
   */
  onDevLog?: (emitter: DevLogEmitter) => void;
}

// ─── Pipeline ──────────────────────────────────────────────────────────────

/**
 * Create the request handler from a pipeline configuration.
 *
 * Returns a function that processes an incoming Request through all pipeline stages
 * and produces a Response. This is the top-level entry point for the server.
 */
export function createPipeline(config: PipelineConfig): (req: Request) => Promise<Response> {
  const {
    proxy,
    matchRoute,
    render,
    earlyHints,
    stripTrailingSlash = true,
    slowRequestMs = 3000,
    onDevLog,
  } = config;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;
    const startTime = performance.now();

    // Establish per-request trace ID scope (design/17-logging.md §"trace_id is Always Set").
    // This runs before runWithRequestContext so traceId() is available from the
    // very first line of proxy.ts, middleware.ts, and all server code.
    const traceIdValue = generateTraceId();

    return runWithTraceId(traceIdValue, async () => {
      // Establish request context ALS scope so headers() and cookies() work
      // throughout the entire request lifecycle (proxy, middleware, render).
      return runWithRequestContext(req, async () => {
        logRequestReceived({ method, path });

        // Create dev log emitter if in dev mode. The emitter is stored in
        // ALS so cache, access gate, and other modules can emit events
        // without explicit threading.
        const devEmitter = onDevLog ? new DevLogEmitter() : undefined;
        if (devEmitter && onDevLog) {
          onDevLog(devEmitter);
          devEmitter.emit({
            type: 'request-start',
            environment: 'rsc',
            label: `${method} ${path}`,
            id: 'request',
            meta: { method, path, traceId: traceIdValue },
          });
        }

        const runPipeline = async (): Promise<Response> => {
          // Wrap everything in an OTEL root span if a tracer is available.
          // The root span covers the entire request lifecycle.
          const response = await withSpan(
            'http.server.request',
            { 'http.request.method': method, 'url.path': path },
            async () => {
              // If OTEL is active, the root span now exists — replace the UUID
              // fallback with the real OTEL trace ID for log–trace correlation.
              const otelIds = await getOtelTraceId();
              if (otelIds) {
                replaceTraceId(otelIds.traceId, otelIds.spanId);
              }

              if (proxy) {
                return runProxyPhase(req, method, path, devEmitter);
              }
              return handleRequest(req, method, path, devEmitter);
            }
          );

          // Request completed — emit structured logs.
          const durationMs = Math.round(performance.now() - startTime);
          const status = response.status;

          logRequestCompleted({ method, path, status, durationMs });

          if (slowRequestMs > 0 && durationMs > slowRequestMs) {
            logSlowRequest({ method, path, durationMs, threshold: slowRequestMs });
          }

          // Emit request-end dev log event
          if (devEmitter) {
            devEmitter.emit({
              type: 'request-end',
              environment: 'rsc',
              label: 'request-end',
              id: 'request-end',
              meta: { status, durationMs },
            });
          }

          return response;
        };

        // Run the pipeline within dev log ALS scope if emitter exists
        if (devEmitter) {
          return runWithDevLog(devEmitter, runPipeline);
        }
        return runPipeline();
      });
    });
  };

  async function runProxyPhase(
    req: Request,
    method: string,
    path: string,
    devEmitter?: DevLogEmitter
  ): Promise<Response> {
    if (devEmitter) {
      devEmitter.emit({
        type: 'phase-start',
        environment: 'proxy',
        label: 'proxy.ts',
        id: 'proxy',
      });
    }
    try {
      const result = await withSpan('timber.proxy', {}, () =>
        runProxy(config.proxy!, req, () => handleRequest(req, method, path, devEmitter))
      );
      if (devEmitter) {
        devEmitter.emit({
          type: 'phase-end',
          environment: 'proxy',
          label: 'proxy.ts',
          id: 'proxy',
        });
      }
      return result;
    } catch (error) {
      if (devEmitter) {
        devEmitter.emit({
          type: 'phase-end',
          environment: 'proxy',
          label: 'proxy.ts',
          id: 'proxy',
        });
      }
      // Uncaught proxy.ts error → bare HTTP 500
      logProxyError({ error });
      await fireOnRequestError(error, req, 'proxy');
      return new Response(null, { status: 500 });
    }
  }

  async function handleRequest(
    req: Request,
    method: string,
    path: string,
    devEmitter?: DevLogEmitter
  ): Promise<Response> {
    // Stage 1: URL canonicalization
    const url = new URL(req.url);
    const result = canonicalize(url.pathname, stripTrailingSlash);
    if (!result.ok) {
      return new Response(null, { status: result.status });
    }
    const canonicalPathname = result.pathname;

    // Stage 2: Route matching
    const match = matchRoute(canonicalPathname);
    if (!match) {
      // No route matched — render 404.tsx in root layout if available,
      // otherwise fall back to a bare 404 Response.
      if (config.renderNoMatch) {
        const responseHeaders = new Headers();
        return config.renderNoMatch(req, responseHeaders);
      }
      return new Response(null, { status: 404 });
    }

    // Stage 3: 103 Early Hints (before middleware, after match)
    if (earlyHints) {
      // Fire-and-forget — don't block the pipeline
      try {
        await earlyHints(match, req);
      } catch {
        // Early hints failure is non-fatal
      }
    }

    // Stage 4: Leaf middleware.ts (only the leaf route's middleware runs)
    const responseHeaders = new Headers();
    const requestHeaderOverlay = new Headers();

    if (match.middleware) {
      const ctx: MiddlewareContext = {
        req,
        requestHeaders: requestHeaderOverlay,
        headers: responseHeaders,
        params: match.params,
        searchParams: new URL(req.url).searchParams,
      };

      if (devEmitter) {
        devEmitter.emit({
          type: 'phase-start',
          environment: 'rsc',
          label: 'middleware.ts',
          id: 'middleware',
        });
      }
      try {
        const middlewareResponse = await withSpan('timber.middleware', {}, () =>
          runMiddleware(match.middleware!, ctx)
        );
        if (devEmitter) {
          devEmitter.emit({
            type: 'phase-end',
            environment: 'rsc',
            label: 'middleware.ts',
            id: 'middleware',
          });
        }
        if (middlewareResponse) {
          logMiddlewareShortCircuit({ method, path, status: middlewareResponse.status });
          return middlewareResponse;
        }
        // Middleware succeeded without short-circuiting — apply any
        // injected request headers so headers() returns them downstream.
        applyRequestHeaderOverlay(requestHeaderOverlay);
      } catch (error) {
        if (devEmitter) {
          devEmitter.emit({
            type: 'phase-end',
            environment: 'rsc',
            label: 'middleware.ts',
            id: 'middleware',
          });
        }
        // Middleware throw → HTTP 500 (middleware runs before rendering,
        // no error boundary to catch it)
        logMiddlewareError({ method, path, error });
        await fireOnRequestError(error, req, 'handler');
        return new Response(null, { status: 500 });
      }
    }

    // Stage 5: Render (access gates + element tree + renderToReadableStream)
    if (devEmitter) {
      devEmitter.emit({ type: 'phase-start', environment: 'rsc', label: 'render', id: 'render' });
    }
    try {
      const result = await withSpan('timber.render', { 'http.route': canonicalPathname }, () =>
        render(req, match, responseHeaders, requestHeaderOverlay)
      );
      if (devEmitter) {
        devEmitter.emit({ type: 'phase-end', environment: 'rsc', label: 'render', id: 'render' });
      }
      return result;
    } catch (error) {
      if (devEmitter) {
        devEmitter.emit({ type: 'phase-end', environment: 'rsc', label: 'render', id: 'render' });
      }
      logRenderError({ method, path, error });
      await fireOnRequestError(error, req, 'render');
      return new Response(null, { status: 500 });
    }
  }
}

/**
 * Fire the user's onRequestError hook with request context.
 * Extracts request info from the Request object and calls the instrumentation hook.
 */
async function fireOnRequestError(
  error: unknown,
  req: Request,
  phase: 'proxy' | 'handler' | 'render' | 'action' | 'route'
): Promise<void> {
  const url = new URL(req.url);
  const headersObj: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headersObj[k] = v;
  });

  await callOnRequestError(
    error,
    { method: req.method, path: url.pathname, headers: headersObj },
    { phase, routePath: url.pathname, routeType: 'page', traceId: traceId() }
  );
}
