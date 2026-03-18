import type { MiddlewareContext } from '@timber-js/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  // Verify middleware runs before API handler by setting a header
  ctx.headers.set('X-Api-Middleware', 'ran');

  // Short-circuit if a specific header is present (auth simulation)
  if (ctx.req.headers.get('X-Block-Api') === 'true') {
    return new Response(JSON.stringify({ error: 'blocked' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
