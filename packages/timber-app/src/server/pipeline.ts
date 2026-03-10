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
import { runWithRequestContext } from './request-context.js';
import { generateTraceId, runWithTraceId, getOtelTraceId, replaceTraceId, withSpan, traceId } from './tracing.js';
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
  /** Early hints emitter — fires 103 hints after route match, before middleware. */
  earlyHints?: EarlyHintsEmitter;
  /** Whether to strip trailing slashes during canonicalization. Default: true. */
  stripTrailingSlash?: boolean;
  /** Slow request threshold in ms. Requests exceeding this emit a warning. 0 to disable. Default: 3000. */
  slowRequestMs?: number;
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

        let response: Response;

        // Wrap everything in an OTEL root span if a tracer is available.
        // The root span covers the entire request lifecycle.
        response = await withSpan(
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
              return runProxyPhase(req, method, path);
            }
            return handleRequest(req, method, path);
          }
        );

        // Request completed — emit structured logs.
        const durationMs = Math.round(performance.now() - startTime);
        const status = response.status;

        logRequestCompleted({ method, path, status, durationMs });

        if (slowRequestMs > 0 && durationMs > slowRequestMs) {
          logSlowRequest({ method, path, durationMs, threshold: slowRequestMs });
        }

        return response;
      });
    });
  };

  async function runProxyPhase(req: Request, method: string, path: string): Promise<Response> {
    try {
      return await withSpan(
        'timber.proxy',
        {},
        () => runProxy(config.proxy!, req, () => handleRequest(req, method, path))
      );
    } catch (error) {
      // Uncaught proxy.ts error → bare HTTP 500
      logProxyError({ error });
      await fireOnRequestError(error, req, 'proxy');
      return new Response(null, { status: 500 });
    }
  }

  async function handleRequest(req: Request, method: string, path: string): Promise<Response> {
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
      // X-Timber-No-Match signals "no route found" to the dev server,
      // distinguishing it from a 404 produced by deny() during render.
      return new Response(null, {
        status: 404,
        headers: { 'X-Timber-No-Match': '1' },
      });
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

      try {
        const middlewareResponse = await withSpan(
          'timber.middleware',
          {},
          () => runMiddleware(match.middleware!, ctx)
        );
        if (middlewareResponse) {
          logMiddlewareShortCircuit({ method, path, status: middlewareResponse.status });
          return middlewareResponse;
        }
      } catch (error) {
        // Middleware throw → HTTP 500 (middleware runs before rendering,
        // no error boundary to catch it)
        logMiddlewareError({ method, path, error });
        await fireOnRequestError(error, req, 'handler');
        return new Response(null, { status: 500 });
      }
    }

    // Stage 5: Render (access gates + element tree + renderToReadableStream)
    try {
      return await withSpan(
        'timber.render',
        { 'http.route': canonicalPathname },
        () => render(req, match, responseHeaders, requestHeaderOverlay)
      );
    } catch (error) {
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
