import type { MiddlewareContext } from '@timber/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  // Verify params are fully resolved before middleware runs
  ctx.requestHeaders.set('X-Slug-Param', String(ctx.params.slug));
  ctx.headers.set('X-Slug-From-Middleware', String(ctx.params.slug));
}
