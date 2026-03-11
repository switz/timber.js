import type { AccessContext } from '@timber/app/server';
import { deny } from '@timber/app/server';

// Always denies — tests slot graceful degradation to default.tsx
export default async function access(_ctx: AccessContext) {
  deny();
}
