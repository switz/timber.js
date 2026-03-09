/**
 * Request pipeline — the central dispatch for all timber.js requests.
 *
 * Pipeline stages (in order):
 *   proxy.ts → canonicalize → route match → 103 Early Hints → middleware.ts → render
 *
 * Each stage is a pure function or returns a Response to short-circuit.
 *
 * See design/07-routing.md §"Request Lifecycle" and design/02-rendering-pipeline.md §"Request Flow"
 */

import { canonicalize } from './canonicalize.js';
import { runProxy, type ProxyExport } from './proxy.js';
import { runMiddleware, type MiddlewareFn } from './middleware-runner.js';
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
}

// ─── Pipeline ──────────────────────────────────────────────────────────────

/**
 * Create the request handler from a pipeline configuration.
 *
 * Returns a function that processes an incoming Request through all pipeline stages
 * and produces a Response. This is the top-level entry point for the server.
 */
export function createPipeline(config: PipelineConfig): (req: Request) => Promise<Response> {
  const { proxy, matchRoute, render, earlyHints, stripTrailingSlash = true } = config;

  return async (req: Request): Promise<Response> => {
    // Wrap everything in proxy.ts if it exists.
    // proxy.ts has next() and can wrap the entire lifecycle.
    if (proxy) {
      try {
        return await runProxy(proxy, req, () => handleRequest(req));
      } catch (error) {
        // Uncaught proxy.ts error → bare HTTP 500
        logError('proxy.ts', error);
        return new Response(null, { status: 500 });
      }
    }
    return handleRequest(req);
  };

  async function handleRequest(req: Request): Promise<Response> {
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

      try {
        const middlewareResponse = await runMiddleware(match.middleware, ctx);
        if (middlewareResponse) {
          return middlewareResponse;
        }
      } catch (error) {
        // Middleware throw → HTTP 500 (middleware runs before rendering,
        // no error boundary to catch it)
        logError('middleware.ts', error);
        return new Response(null, { status: 500 });
      }
    }

    // Stage 5: Render (access gates + element tree + renderToReadableStream)
    return render(req, match, responseHeaders, requestHeaderOverlay);
  }
}

function logError(phase: string, error: unknown): void {
  console.error(`[timber] Uncaught error in ${phase}:`, error);
}
