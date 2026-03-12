import type { MiddlewareContext } from '@timber/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  // Read a cookie from the request
  const cookieHeader = ctx.req.headers.get('Cookie') ?? '';
  const testCookie = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('test-cookie='));
  const cookieValue = testCookie?.split('=')[1] ?? 'none';

  // Inject the read value as a request header for downstream components
  ctx.requestHeaders.set('X-Read-Cookie', cookieValue);

  // Set a response cookie
  ctx.headers.set('Set-Cookie', 'middleware-cookie=set-by-middleware; Path=/; HttpOnly');
}
