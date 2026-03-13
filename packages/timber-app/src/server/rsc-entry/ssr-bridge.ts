/**
 * SSR Bridge — loads the SSR entry and passes the RSC stream for HTML rendering.
 */

/// <reference types="@vitejs/plugin-rsc/types" />

import type { NavContext } from '@/server/ssr-entry.js';

export async function callSsr(
  rscStream: ReadableStream<Uint8Array>,
  navContext: NavContext
): Promise<Response> {
  const ssrEntry = await import.meta.viteRsc.import<typeof import('@/server/ssr-entry.js')>(
    '../ssr-entry.js',
    { environment: 'ssr' }
  );
  return ssrEntry.handleSsr(rscStream, navContext);
}
