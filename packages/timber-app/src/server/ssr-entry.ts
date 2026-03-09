/**
 * SSR Entry — Receives RSC stream and renders HTML.
 *
 * This is a real TypeScript file, not codegen. The RSC plugin calls
 * handleSsr() to convert the RSC stream + navigation context into
 * an HTML Response.
 *
 * Design docs: 18-build-system.md §"Entry Files", 02-rendering-pipeline.md
 */

// @ts-expect-error — virtual module provided by timber-entries plugin
import config from 'virtual:timber-config';

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
 * Handle SSR: receive an RSC stream and render it to HTML.
 *
 * @param rscStream - The ReadableStream from the RSC environment
 * @param navContext - Per-request state passed across RSC→SSR boundary
 * @returns A Response containing the HTML stream
 */
export async function handleSsr(
  rscStream: ReadableStream<Uint8Array>,
  navContext: NavContext,
): Promise<Response> {
  // TODO: Implement once renderToReadableStream wiring is in place.
  // Steps:
  // 1. Decode RSC stream into React element tree (via react-server-dom)
  // 2. Call renderToReadableStream with the decoded tree
  // 3. Wait for onShellReady
  // 4. Return Response with navContext.statusCode and navContext.responseHeaders
  const _runtimeConfig = config;

  return new Response(rscStream, {
    status: navContext.statusCode,
    headers: navContext.responseHeaders,
  });
}

export default handleSsr;
