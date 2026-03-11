import type { AccessContext } from '@timber/app/server';
import { redirect } from '@timber/app/server';

export default async function access(_ctx: AccessContext) {
  redirect('/');
}
