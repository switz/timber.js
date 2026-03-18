import type { AccessContext } from '@timber-js/app/server';
import { deny } from '@timber-js/app/server';

// Child access gate — always denies.
// Tests nested gates: parent passes, child denies → HTTP 403.
export default async function access(_ctx: AccessContext) {
  deny();
}
