/**
 * Route handler for route.ts API endpoints.
 *
 * route.ts files export named HTTP method handlers (GET, POST, etc.).
 * They share the same pipeline (proxy → match → middleware → access → handler)
 * but don't render React trees.
 *
 * See design/07-routing.md §"route.ts — API Endpoints"
 */

import type { RouteContext } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────

/** HTTP methods that route.ts can export as named handlers. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** A single route handler function — one-arg signature. */
export type RouteHandler = (ctx: RouteContext) => Response | Promise<Response>;

/** A route.ts module — named exports for each supported HTTP method. */
export type RouteModule = {
  [K in HttpMethod]?: RouteHandler;
};

/** All recognized HTTP method export names. */
const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ─── Allowed Methods ─────────────────────────────────────────────────────

/**
 * Resolve the full list of allowed methods for a route module.
 *
 * Includes:
 * - All explicitly exported methods
 * - HEAD (implicit when GET is exported)
 * - OPTIONS (always implicit)
 */
export function resolveAllowedMethods(mod: RouteModule): HttpMethod[] {
  const methods: HttpMethod[] = [];

  for (const method of HTTP_METHODS) {
    if (method === 'HEAD' || method === 'OPTIONS') continue;
    if (mod[method]) {
      methods.push(method);
    }
  }

  // HEAD is implicit when GET is exported
  if (mod.GET && !mod.HEAD) {
    methods.push('HEAD');
  } else if (mod.HEAD) {
    methods.push('HEAD');
  }

  // OPTIONS is always implicit
  if (!mod.OPTIONS) {
    methods.push('OPTIONS');
  } else {
    methods.push('OPTIONS');
  }

  return methods;
}

// ─── Route Request Handler ───────────────────────────────────────────────

/**
 * Handle an incoming request against a route.ts module.
 *
 * Dispatches to the named method handler, auto-generates 405/OPTIONS,
 * and merges response headers from ctx.headers.
 */
export async function handleRouteRequest(mod: RouteModule, ctx: RouteContext): Promise<Response> {
  const method = ctx.req.method.toUpperCase() as HttpMethod;
  const allowed = resolveAllowedMethods(mod);
  const allowHeader = allowed.join(', ');

  // Auto OPTIONS — 204 with Allow header
  if (method === 'OPTIONS') {
    if (mod.OPTIONS) {
      return runHandler(mod.OPTIONS, ctx);
    }
    return new Response(null, {
      status: 204,
      headers: { Allow: allowHeader },
    });
  }

  // HEAD fallback — run GET, strip body
  if (method === 'HEAD') {
    if (mod.HEAD) {
      return runHandler(mod.HEAD, ctx);
    }
    if (mod.GET) {
      const res = await runHandler(mod.GET, ctx);
      // Return headers + status but no body
      return new Response(null, {
        status: res.status,
        headers: res.headers,
      });
    }
  }

  // Dispatch to the named handler
  const handler = mod[method];
  if (!handler) {
    return new Response(null, {
      status: 405,
      headers: { Allow: allowHeader },
    });
  }

  return runHandler(handler, ctx);
}

/**
 * Run a handler, merge ctx.headers into the response, and catch errors.
 */
async function runHandler(handler: RouteHandler, ctx: RouteContext): Promise<Response> {
  try {
    const res = await handler(ctx);
    return mergeResponseHeaders(res, ctx.headers);
  } catch (error) {
    console.error('[timber] Uncaught error in route.ts handler:', error);
    return new Response(null, { status: 500 });
  }
}

/**
 * Merge response headers from ctx.headers into the handler's response.
 * ctx.headers (set by middleware or the handler) are applied to the final response.
 * Handler-set headers take precedence over ctx.headers.
 */
function mergeResponseHeaders(res: Response, ctxHeaders: Headers): Response {
  // If no ctx headers to merge, return as-is
  let hasCtxHeaders = false;
  ctxHeaders.forEach(() => {
    hasCtxHeaders = true;
  });
  if (!hasCtxHeaders) return res;

  // Merge: ctx.headers first, then handler response headers override
  const merged = new Headers();
  ctxHeaders.forEach((value, key) => merged.set(key, value));
  res.headers.forEach((value, key) => merged.set(key, value));

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: merged,
  });
}
