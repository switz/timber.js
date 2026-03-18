import type { AccessContext } from '@timber-js/app/server';
import { deny } from '@timber-js/app/server';

// Always denies — tests that access.ts runs for API routes (route.ts)
export default async function access(_ctx: AccessContext) {
  deny(401);
}
