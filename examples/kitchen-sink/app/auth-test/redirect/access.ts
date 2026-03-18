import type { AccessContext } from '@timber-js/app/server';
import { redirect } from '@timber-js/app/server';

export default async function access(_ctx: AccessContext) {
  redirect('/');
}
