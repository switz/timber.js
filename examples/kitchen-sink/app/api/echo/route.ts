import type { RouteContext } from '@timber/app/server';

export async function GET(ctx: RouteContext) {
  const query = Object.fromEntries(ctx.searchParams.entries());
  return Response.json({ method: 'GET', query });
}

export async function POST(ctx: RouteContext) {
  const body = await ctx.req.json();
  return Response.json({ method: 'POST', body });
}
