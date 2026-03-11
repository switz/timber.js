import type { AccessContext } from '@timber/app/server';
import { deny } from '@timber/app/server';

export default async function access(_ctx: AccessContext) {
  deny();
}
