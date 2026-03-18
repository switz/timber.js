import type { MiddlewareContext } from '@timber-js/app/server';

export default async function middleware(_ctx: MiddlewareContext): Promise<Response | void> {
  return new Response('Forbidden by middleware', { status: 403 });
}
