import type { RouteContext } from '@timber-js/app/server';

export async function GET(_ctx: RouteContext) {
  return Response.json({ method: 'GET', ok: true });
}
