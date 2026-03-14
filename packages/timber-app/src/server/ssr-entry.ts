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
import { injectHead, injectRscPayload } from './html-injectors.js';
import { withNuqsSsrAdapter } from './nuqs-ssr-provider.js';
import { withSpan } from './tracing.js';
import { setCurrentParams } from '#/client/use-params.js';

/**
 * Navigation context passed from the RSC environment to SSR.
 *
 * Per-request state must be explicitly passed across the RSC→SSR
 * environment boundary since they are separate Vite module graphs.
 */
export interface NavContext {
  /** The requested pathname */
  pathname: string;
  /** Extracted route params (catch-all segments produce string[]) */
  params: Record<string, string | string[]>;
  /** Search params from the URL */
  searchParams: Record<string, string>;
  /** The committed HTTP status code */
  statusCode: number;
  /** Response headers from middleware/proxy */
  responseHeaders: Headers;
  /** Pre-rendered metadata HTML to inject before </head> */
  headHtml: string;
  /** Inline JS for React's bootstrapScriptContent — kicks off module loading */
  bootstrapScriptContent: string;
  /** Tee'd RSC stream for client-side hydration (inlined into HTML) */
  rscStream?: ReadableStream<Uint8Array>;
  /** Max Suspense hold window (ms). SSR delays the first flush by this
   *  duration, racing allReady so that fast-resolving boundaries render inline
   *  without ever showing a fallback. Derived from route `deferSuspenseFor` exports.
   *  See design/05-streaming.md §"deferSuspenseFor". */
  deferSuspenseFor?: number;
  /** Request abort signal. When the client disconnects (page refresh,
   *  navigation away), this signal fires. Passed to renderToReadableStream
   *  so React stops rendering and doesn't fire error boundaries for aborts. */
  signal?: AbortSignal;
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
 * The RSC stream is piped progressively — not buffered. For deny() outside
 * Suspense, the RSC stream encodes an error in the shell region, causing
 * renderToReadableStream to reject. The error propagates back to the RSC
 * entry which renders the deny page. For deny() inside Suspense, the shell
 * succeeds and the error streams as a React error boundary after flush.
 *
 * @param rscStream - The ReadableStream from the RSC environment
 * @param navContext - Per-request state passed across RSC→SSR boundary
 * @returns A Response containing the HTML stream with hydration markers
 */
export async function handleSsr(
  rscStream: ReadableStream<Uint8Array>,
  navContext: NavContext
): Promise<Response> {
  return withSpan('timber.ssr', { 'timber.environment': 'ssr' }, async () => {
    const _runtimeConfig = config;

    // Populate useParams() for client components rendered during SSR.
    // The SSR environment has its own module instance of use-params.ts,
    // so the module-level currentParams must be set before React's
    // synchronous shell render reads it. React's renderToReadableStream
    // renders the shell synchronously before returning, so this is safe
    // against concurrent requests — each request sets params, renders
    // the shell, and the next request sets its own params before its render.
    setCurrentParams(navContext.params);

    // Decode the RSC stream into a React element tree.
    // createFromReadableStream resolves client component references
    // (from "use client" modules) using the SSR environment's module
    // map, importing the actual components for server-side rendering.
    const element = createFromReadableStream(rscStream) as React.ReactNode;

    // Wrap with a server-safe nuqs adapter so that 'use client' components
    // that call nuqs hooks (useQueryStates, useQueryState) can SSR correctly.
    // The client-side TimberNuqsAdapter (injected by browser-entry.ts) takes
    // over after hydration. This provider supplies the request's search params
    // as a static snapshot so nuqs renders the right initial values on the server.
    const wrappedElement = withNuqsSsrAdapter(navContext.searchParams, element);

    // Render to HTML stream (waits for onShellReady).
    // Pass bootstrapScriptContent so React injects a non-deferred <script>
    // in the shell HTML. This executes immediately during parsing — even
    // while Suspense boundaries are still streaming — triggering module
    // loading via dynamic import() so hydration can start early.
    const htmlStream = await renderSsrStream(wrappedElement, {
      bootstrapScriptContent: navContext.bootstrapScriptContent || undefined,
      deferSuspenseFor: navContext.deferSuspenseFor,
      signal: navContext.signal,
    });

    // Inject metadata into <head>, then interleave RSC payload chunks
    // into the body as they arrive from the tee'd RSC stream.
    let outputStream = injectHead(htmlStream, navContext.headHtml);
    outputStream = injectRscPayload(outputStream, navContext.rscStream);

    // Build and return the Response.
    return buildSsrResponse(outputStream, navContext.statusCode, navContext.responseHeaders);
  });
}

export default handleSsr;
