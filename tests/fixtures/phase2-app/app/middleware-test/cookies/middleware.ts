import { cookies } from '@timber/app/server';
import type { MiddlewareContext } from '@timber/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  // Read a cookie from the request using the cookies() API
  const cookieValue = cookies().get('test-cookie') ?? 'none';

  // Inject the read value as a request header for downstream components
  ctx.requestHeaders.set('X-Read-Cookie', cookieValue);

  // Set a response cookie using the cookies() API (secure defaults applied automatically)
  cookies().set('middleware-cookie', 'set-by-middleware');

  // Test read-your-own-writes: set a cookie, then read it back
  cookies().set('ryw-cookie', 'written-in-middleware');
  const rywValue = cookies().get('ryw-cookie') ?? 'not-found';
  ctx.requestHeaders.set('X-RYW-Cookie', rywValue);
}
