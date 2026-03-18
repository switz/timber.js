import type { RouteContext } from '@timber-js/app/server';

export async function GET(_ctx: RouteContext) {
  return Response.json({ message: 'api-ok', method: 'GET' });
}

export async function POST(_ctx: RouteContext) {
  return Response.json({ message: 'api-ok', method: 'POST' }, { status: 201 });
}
