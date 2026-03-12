import type { RouteContext } from '@timber/app/server';

export async function GET(_ctx: RouteContext) {
  return Response.json({ ok: true, ts: Date.now() });
}
