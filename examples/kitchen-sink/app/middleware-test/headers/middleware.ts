import type { MiddlewareContext } from '@timber-js/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.headers.set('Cache-Control', 'private, max-age=0');
  ctx.headers.set('X-Test', 'middleware-header-value');
}
