// Catches /docs/getting-started (no version) and redirects to latest
import { redirect } from '@timber/app/server';
import { LATEST_VERSION } from '@/lib/docs';

export default async function middleware(ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  redirect(`/docs/${LATEST_VERSION}/${slug}`);
}
