import type { AccessContext } from '@timber-js/app/server';
import { deny } from '@timber-js/app/server';

export default async function access(_ctx: AccessContext) {
  // Always deny the admin slot to test denied.tsx rendering
  deny();
}
