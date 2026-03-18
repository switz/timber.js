import { redirect } from '@timber-js/app/server';
import { LATEST_VERSION } from '@/lib/docs';

export default async function middleware() {
  redirect(`/docs/${LATEST_VERSION}`);
}
