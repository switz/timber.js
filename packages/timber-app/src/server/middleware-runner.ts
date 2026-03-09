/**
 * Middleware runner — executes a route's middleware.ts before rendering.
 *
 * Only the leaf route's middleware runs. There is no middleware chain.
 * Middleware does NOT have next() — it either short-circuits with a Response
 * or returns void to continue to access checks + render.
 *
 * See design/07-routing.md §"middleware.ts"
 */

import type { MiddlewareContext } from './types.js';

/** Signature of a middleware.ts default export. */
export type MiddlewareFn = (ctx: MiddlewareContext) => Response | void | Promise<Response | void>;

/**
 * Run a route's middleware function.
 *
 * @param middlewareFn - The default export from the route's middleware.ts
 * @param ctx - The middleware context (req, params, headers, requestHeaders, searchParams)
 * @returns A Response if middleware short-circuited, or undefined to continue
 */
export async function runMiddleware(
  middlewareFn: MiddlewareFn,
  ctx: MiddlewareContext
): Promise<Response | undefined> {
  const result = await middlewareFn(ctx);
  if (result instanceof Response) {
    return result;
  }
  return undefined;
}
