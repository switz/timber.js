import type { MiddlewareContext } from '@timber/app/server';

/**
 * Parent middleware — per design, this should NOT run when the nested page is requested.
 * Only the leaf route's middleware runs.
 */
export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.headers.set('X-Parent-Middleware', 'ran');
  ctx.requestHeaders.set('X-Parent-Middleware', 'ran');
}
