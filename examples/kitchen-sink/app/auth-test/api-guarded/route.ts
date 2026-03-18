import type { RouteContext } from '@timber-js/app/server';

// This handler should never execute — access.ts denies before it runs.
export async function GET(_ctx: RouteContext) {
  return Response.json({ message: 'should not reach here' });
}
