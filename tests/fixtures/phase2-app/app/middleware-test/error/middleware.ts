import type { MiddlewareContext } from '@timber/app/server';

export default async function middleware(_ctx: MiddlewareContext): Promise<Response | void> {
  throw new Error('Middleware intentional error');
}
