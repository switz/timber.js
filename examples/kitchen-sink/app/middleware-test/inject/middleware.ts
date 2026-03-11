import type { MiddlewareContext } from '@timber/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.requestHeaders.set('X-Locale', 'en-Works!');
}
