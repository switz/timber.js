import type { RouteContext } from '@timber-js/app/server';

export async function GET(_ctx: RouteContext) {
  throw new Error('Intentional test error');
}
