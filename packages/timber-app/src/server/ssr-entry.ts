/**
 * SSR Entry — Receives RSC stream and renders HTML with hydration markers.
 *
 * This is a real TypeScript file, not codegen. The RSC environment calls
 * handleSsr() to convert the RSC stream + navigation context into
 * an HTML Response with React hydration support.
 *
 * The RSC and SSR environments are separate Vite module graphs with
 * separate module instances. Per-request state is explicitly passed
 * via NavContext.
 *
 * Design docs: 18-build-system.md §"Entry Files", 02-rendering-pipeline.md
 */

// @ts-expect-error — virtual module provided by timber-entries plugin
import config from 'virtual:timber-config';
import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr';

import { renderSsrStream, buildSsrResponse } from './ssr-render.js';

/**
 * Navigation context passed from the RSC environment to SSR.
 *
 * Per-request state must be explicitly passed across the RSC→SSR
 * environment boundary since they are separate Vite module graphs.
 */
export interface NavContext {
  /** The requested pathname */
  pathname: string;
  /** Extracted route params */
  params: Record<string, string>;
  /** Search params from the URL */
  searchParams: Record<string, string>;
  /** The committed HTTP status code */
  statusCode: number;
  /** Response headers from middleware/proxy */
  responseHeaders: Headers;
}

/**
 * Handle SSR: decode an RSC stream and render it to hydration-ready HTML.
 *
 * Steps:
 * 1. Decode the RSC stream into a React element tree via createFromReadableStream
 * 2. Render the decoded tree to HTML via renderToReadableStream (streaming)
 * 3. Wait for onShellReady before flushing (handled by renderSsrStream)
 * 4. Return Response with navContext.statusCode and navContext.responseHeaders
 *
 * @param rscStream - The ReadableStream from the RSC environment
 * @param navContext - Per-request state passed across RSC→SSR boundary
 * @returns A Response containing the HTML stream with hydration markers
 */
export async function handleSsr(
  rscStream: ReadableStream<Uint8Array>,
  navContext: NavContext
): Promise<Response> {
  const _runtimeConfig = config;

  // Decode the RSC stream into a React element tree.
  // createFromReadableStream returns a thenable that resolves to the
  // React element tree encoded in the RSC payload. The return type is
  // untyped (vendored react-server-dom); cast to ReactNode.
  const element = createFromReadableStream(rscStream) as React.ReactNode;

  // Step 2 & 3: Render to HTML stream (waits for onShellReady).
  const htmlStream = await renderSsrStream(element);

  // Step 4: Build and return the Response.
  return buildSsrResponse(htmlStream, navContext.statusCode, navContext.responseHeaders);
}

export default handleSsr;
