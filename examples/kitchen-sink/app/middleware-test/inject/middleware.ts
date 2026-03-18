import type { MiddlewareContext } from '@timber-js/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.requestHeaders.set('X-Locale', 'timber-inject-test-value');
}
