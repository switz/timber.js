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
import { injectHead, injectScripts } from './html-injectors.js';

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
  /** Pre-rendered metadata HTML to inject before </head> */
  headHtml: string;
  /** Client bootstrap script tags to inject before </body> */
  scriptsHtml: string;
}

/**
 * Handle SSR: decode an RSC stream and render it to hydration-ready HTML.
 *
 * Steps:
 * 1. Decode the RSC stream into a React element tree via createFromReadableStream
 *    (resolves "use client" references to actual component modules for SSR)
 * 2. Render the decoded tree to HTML via renderToReadableStream (streaming)
 * 3. Wait for onShellReady before flushing (handled by renderSsrStream)
 * 4. Inject metadata into <head> and client scripts before </body>
 * 5. Return Response with navContext.statusCode and navContext.responseHeaders
 *
 * DenySignal handling is done entirely in the RSC entry (rsc-entry.ts).
 * By the time handleSsr is called, the RSC stream already contains either
 * the normal page or a rendered error page — SSR doesn't need to detect
 * or handle DenySignal at all.
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
  // createFromReadableStream resolves client component references
  // (from "use client" modules) using the SSR environment's module
  // map, importing the actual components for server-side rendering.
  const element = createFromReadableStream(rscStream) as React.ReactNode;

  // Render to HTML stream (waits for onShellReady).
  const htmlStream = await renderSsrStream(element);

  // Inject metadata into <head> and client scripts before </body>.
  // The layout renders <html><head>...</head><body>...</body></html>.
  let outputStream = injectHead(htmlStream, navContext.headHtml);
  outputStream = injectScripts(outputStream, navContext.scriptsHtml);

  // Build and return the Response.
  return buildSsrResponse(outputStream, navContext.statusCode, navContext.responseHeaders);
}

export default handleSsr;
