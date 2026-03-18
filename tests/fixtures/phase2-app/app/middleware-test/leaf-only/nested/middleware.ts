import type { MiddlewareContext } from '@timber-js/app/server';

/**
 * Nested (leaf) middleware — this IS the leaf and should run.
 */
export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.headers.set('X-Nested-Middleware', 'ran');
  ctx.requestHeaders.set('X-Nested-Middleware', 'ran');
}
