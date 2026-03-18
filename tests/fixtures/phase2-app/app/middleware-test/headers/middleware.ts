import type { MiddlewareContext } from '@timber-js/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  // Set response headers
  ctx.headers.set('X-Custom-Header', 'middleware-value');
  ctx.headers.set('Cache-Control', 'private, max-age=0');

  // Inject request headers visible downstream via headers()
  ctx.requestHeaders.set('X-Injected', 'from-middleware');
}
