import type { MiddlewareContext } from '@timber-js/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  ctx.headers.set('X-Nav-Middleware', 'ran');
  ctx.requestHeaders.set('X-Nav-Timestamp', String(Date.now()));
}
