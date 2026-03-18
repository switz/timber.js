import type { RouteContext } from '@timber-js/app/server';

export async function GET(ctx: RouteContext) {
  const id = ctx.params.id;
  return Response.json({ id, name: `User ${id}` });
}

export async function DELETE(ctx: RouteContext) {
  // 204 No Content — resource deleted
  void ctx;
  return new Response(null, { status: 204 });
}

export async function PUT(ctx: RouteContext) {
  const body = await ctx.req.json();
  return Response.json({ id: ctx.params.id, ...body }, { status: 200 });
}

export async function PATCH(ctx: RouteContext) {
  const body = await ctx.req.json();
  return Response.json({ id: ctx.params.id, patched: true, ...body });
}
