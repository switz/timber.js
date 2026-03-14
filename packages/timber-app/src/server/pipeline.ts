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
import {
  runWithRequestContext,
  applyRequestHeaderOverlay,
  setMutableCookieContext,
  getSetCookieHeaders,
  markResponseFlushed,
} from './request-context.js';
import {
  generateTraceId,
  runWithTraceId,
  getOtelTraceId,
  replaceTraceId,
  withSpan,
  setSpanAttribute,
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
import type { MiddlewareContext } from './types.js';
import type { SegmentNode } from '#/routing/types.js';

// ─── Route Match Result ────────────────────────────────────────────────────

/** Result of matching a canonical pathname against the route tree. */
export interface RouteMatch {
  /** The matched segment chain from root to leaf. */
  segments: SegmentNode[];
  /** Extracted route params (catch-all segments produce string[]). */
  params: Record<string, string | string[]>;
  /** The leaf segment's middleware.ts export, if any. */
  middleware?: MiddlewareFn;
}

/** Function that matches a canonical pathname to a route. */
export type RouteMatcher = (pathname: string) => RouteMatch | null;

/** Context for intercepting route resolution (modal pattern). */
export interface InterceptionContext {
  /** The URL the user is navigating TO (the intercepted route). */
  targetPathname: string;
}

/** Function that renders a matched route into a Response. */
export type RouteRenderer = (
  req: Request,
  match: RouteMatch,
  responseHeaders: Headers,
  requestHeaderOverlay: Headers,
  interception?: InterceptionContext
) => Response | Promise<Response>;

/** Function that sends 103 Early Hints for a matched route. */
export type EarlyHintsEmitter = (
  match: RouteMatch,
  req: Request,
  responseHeaders: Headers
) => void | Promise<void>;

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
   * Interception rewrites — conditional routes for the modal pattern.
   * Generated at build time from intercepting route directories.
   * See design/07-routing.md §"Intercepting Routes"
   */
  interceptionRewrites?: import('#/routing/interception.js').InterceptionRewrite[];
  /**
   * Dev pipeline error callback — called when a pipeline phase (proxy,
   * middleware, render) catches an unhandled error. Used to wire the error
   * into the Vite browser error overlay in dev mode.
   *
   * Undefined in production — zero overhead.
   */
  onPipelineError?: (error: Error, phase: string) => void;
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
    onPipelineError,
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

            let result: Response;
            if (proxy) {
              result = await runProxyPhase(req, method, path);
            } else {
              result = await handleRequest(req, method, path);
            }

            // Set response status on the root span before it ends —
            // DevSpanProcessor reads this for tree/summary output.
            await setSpanAttribute('http.response.status_code', result.status);
            return result;
          }
        );

        // Post-span: structured production logging
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
      return await withSpan('timber.proxy', {}, () =>
        runProxy(config.proxy!, req, () => handleRequest(req, method, path))
      );
    } catch (error) {
      // Uncaught proxy.ts error → bare HTTP 500
      logProxyError({ error });
      await fireOnRequestError(error, req, 'proxy');
      if (onPipelineError && error instanceof Error) onPipelineError(error, 'proxy');
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
    let match = matchRoute(canonicalPathname);
    let interception: InterceptionContext | undefined;

    // Stage 2a: Intercepting route resolution (modal pattern).
    // On soft navigation, check if an intercepting route should render instead.
    // The client sends X-Timber-URL with the current pathname (where they're
    // navigating FROM). If a rewrite matches, re-route to the source URL so
    // the source layout renders with the intercepted content in the slot.
    const sourceUrl = req.headers.get('X-Timber-URL');
    if (sourceUrl && config.interceptionRewrites?.length) {
      const intercepted = findInterceptionMatch(
        canonicalPathname,
        sourceUrl,
        config.interceptionRewrites
      );
      if (intercepted) {
        const sourceMatch = matchRoute(intercepted.sourcePathname);
        if (sourceMatch) {
          match = sourceMatch;
          interception = { targetPathname: canonicalPathname };
        }
      }
    }

    if (!match) {
      // No route matched — render 404.tsx in root layout if available,
      // otherwise fall back to a bare 404 Response.
      if (config.renderNoMatch) {
        const responseHeaders = new Headers();
        return config.renderNoMatch(req, responseHeaders);
      }
      return new Response(null, { status: 404 });
    }

    // Response and request header containers — created before early hints so
    // the emitter can append Link headers (e.g. for Cloudflare CDN → 103).
    const responseHeaders = new Headers();
    const requestHeaderOverlay = new Headers();

    // Stage 2b: 103 Early Hints (before middleware, after match)
    // Fires before middleware so the browser can begin fetching critical
    // assets while middleware runs. Non-fatal — a failing emitter never
    // blocks the request.
    if (earlyHints) {
      try {
        await earlyHints(match, req, responseHeaders);
      } catch {
        // Early hints failure is non-fatal
      }
    }

    // Stage 3: Leaf middleware.ts (only the leaf route's middleware runs)
    if (match.middleware) {
      const ctx: MiddlewareContext = {
        req,
        requestHeaders: requestHeaderOverlay,
        headers: responseHeaders,
        params: match.params,
        searchParams: new URL(req.url).searchParams,
        earlyHints: (hints) => {
          for (const hint of hints) {
            let value = `<${hint.href}>; rel=${hint.rel}`;
            if (hint.as !== undefined) value += `; as=${hint.as}`;
            if (hint.crossOrigin !== undefined) value += `; crossorigin=${hint.crossOrigin}`;
            if (hint.fetchPriority !== undefined) value += `; fetchpriority=${hint.fetchPriority}`;
            responseHeaders.append('Link', value);
          }
        },
      };

      try {
        // Enable cookie mutation during middleware (design/29-cookies.md §"Context Tracking")
        setMutableCookieContext(true);
        const middlewareResponse = await withSpan('timber.middleware', {}, () =>
          runMiddleware(match.middleware!, ctx)
        );
        setMutableCookieContext(false);
        if (middlewareResponse) {
          // Apply cookie jar to short-circuit response
          applyCookieJar(middlewareResponse.headers);
          logMiddlewareShortCircuit({ method, path, status: middlewareResponse.status });
          return middlewareResponse;
        }
        // Middleware succeeded without short-circuiting — apply any
        // injected request headers so headers() returns them downstream.
        applyRequestHeaderOverlay(requestHeaderOverlay);
      } catch (error) {
        setMutableCookieContext(false);
        // Middleware throw → HTTP 500 (middleware runs before rendering,
        // no error boundary to catch it)
        logMiddlewareError({ method, path, error });
        await fireOnRequestError(error, req, 'handler');
        if (onPipelineError && error instanceof Error) onPipelineError(error, 'middleware');
        return new Response(null, { status: 500 });
      }
    }

    // Apply cookie jar to response headers before render commits them.
    // Middleware may have set cookies; they need to be on responseHeaders
    // before flushResponse creates the Response object.
    applyCookieJar(responseHeaders);

    // Stage 4: Render (access gates + element tree + renderToReadableStream)
    try {
      const response = await withSpan('timber.render', { 'http.route': canonicalPathname }, () =>
        render(req, match, responseHeaders, requestHeaderOverlay, interception)
      );
      markResponseFlushed();
      return response;
    } catch (error) {
      logRenderError({ method, path, error });
      await fireOnRequestError(error, req, 'render');
      if (onPipelineError && error instanceof Error) onPipelineError(error, 'render');
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

// ─── Interception Matching ────────────────────────────────────────────────

interface InterceptionMatchResult {
  /** The pathname to re-match (the source/intercepting route's parent). */
  sourcePathname: string;
}

/**
 * Check if an intercepting route applies for this soft navigation.
 *
 * Matches the target pathname against interception rewrites, constrained
 * by the source URL (X-Timber-URL header — where the user navigates FROM).
 *
 * Returns the source pathname to re-match if interception applies, or null.
 */
function findInterceptionMatch(
  targetPathname: string,
  sourceUrl: string,
  rewrites: import('#/routing/interception.js').InterceptionRewrite[]
): InterceptionMatchResult | null {
  for (const rewrite of rewrites) {
    // Check if the source URL starts with the intercepting prefix
    if (!sourceUrl.startsWith(rewrite.interceptingPrefix)) continue;

    // Check if the target URL matches the intercepted pattern.
    // Dynamic segments in the pattern match any single URL segment.
    if (pathnameMatchesPattern(targetPathname, rewrite.interceptedPattern)) {
      return { sourcePathname: rewrite.interceptingPrefix };
    }
  }
  return null;
}

/**
 * Check if a pathname matches a URL pattern with dynamic segments.
 *
 * Supports [param] (single segment) and [...param] (one or more segments).
 * Static segments must match exactly.
 */
function pathnameMatchesPattern(pathname: string, pattern: string): boolean {
  const pathParts = pathname === '/' ? [] : pathname.slice(1).split('/');
  const patternParts = pattern === '/' ? [] : pattern.slice(1).split('/');

  let pi = 0;
  for (let i = 0; i < patternParts.length; i++) {
    const segment = patternParts[i];

    // Catch-all: [...param] or [[...param]] — matches rest of URL
    if (segment.startsWith('[...') || segment.startsWith('[[...')) {
      return pi < pathParts.length || segment.startsWith('[[...');
    }

    // Dynamic: [param] — matches any single segment
    if (segment.startsWith('[') && segment.endsWith(']')) {
      if (pi >= pathParts.length) return false;
      pi++;
      continue;
    }

    // Static — must match exactly
    if (pi >= pathParts.length || pathParts[pi] !== segment) return false;
    pi++;
  }

  return pi === pathParts.length;
}

// ─── Cookie Helpers ──────────────────────────────────────────────────────

/**
 * Apply all Set-Cookie headers from the cookie jar to a Headers object.
 * Each cookie gets its own Set-Cookie header per RFC 6265 §4.1.
 */
function applyCookieJar(headers: Headers): void {
  for (const value of getSetCookieHeaders()) {
    headers.append('Set-Cookie', value);
  }
}
