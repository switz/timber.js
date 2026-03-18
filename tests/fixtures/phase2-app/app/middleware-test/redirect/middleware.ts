import type { MiddlewareContext } from '@timber-js/app/server';

export default async function middleware(ctx: MiddlewareContext): Promise<Response | void> {
  const url = new URL(ctx.req.url);
  if (url.searchParams.get('redirect') === 'true') {
    return Response.redirect(new URL('/', url), 302);
  }
}
