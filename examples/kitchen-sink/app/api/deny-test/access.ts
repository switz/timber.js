import type { AccessContext } from '@timber-js/app/server';
import { deny } from '@timber-js/app/server';

// Always denies with 403 — tests fallback to 4xx.json when no 403.json exists
export default async function access(_ctx: AccessContext) {
  deny(403);
}
