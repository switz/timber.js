/**
 * SSR rendering utilities — testable core of the SSR entry.
 *
 * Extracted from ssr-entry.ts so the rendering logic can be tested
 * independently of the Vite RSC plugin runtime (which provides
 * createFromReadableStream for decoding RSC streams).
 *
 * Design docs: 02-rendering-pipeline.md §"Single-Pass Rendering",
 *              18-build-system.md §"Entry Files"
 */

import type { ReactNode } from 'react';
import { renderToReadableStream } from 'react-dom/server';

import { formatSsrError } from './error-formatter.js';

/**
 * Inline script that injects <meta name="robots" content="noindex"> into <head>.
 *
 * Used when a post-flush error (deny() or throw inside Suspense after the shell
 * has been flushed) is detected. Since <head> has already been sent to the client,
 * we use a script to dynamically add the meta tag. This signals search engines
 * not to index the page, mitigating the SEO impact of a 200 status code on what
 * is effectively an error/deny page.
 *
 * See design/05-streaming.md §"deny() inside Suspense"
 */
const NOINDEX_SCRIPT =
  '<script>document.head.appendChild(Object.assign(document.createElement("meta"),{name:"robots",content:"noindex"}))</script>';

/**
 * Render a React element tree to a ReadableStream of HTML.
 *
 * Uses renderToReadableStream (NOT renderToString) for streaming SSR.
 * The returned stream begins yielding after onShellReady — everything
 * outside <Suspense> boundaries is in the shell.
 *
 * With progressive streaming, the RSC stream is piped directly to SSR
 * without buffering. If deny() was called outside a Suspense boundary,
 * the RSC stream encodes an error in the shell — renderToReadableStream
 * rejects, and the RSC entry catches this to render a deny page with
 * the correct HTTP status code. If deny() was inside Suspense, the shell
 * succeeds (200 committed) and the error streams as an error boundary.
 *
 * @param element - The React element tree decoded from the RSC stream
 * @param options - Optional configuration
 * @param options.bootstrapScriptContent - Inline JS injected by React as a
 *   non-deferred `<script>` in the shell HTML. Executes immediately during
 *   parsing — even while Suspense boundaries are still streaming. Used to
 *   kick off module loading via dynamic `import()` so hydration can start
 *   before the HTML stream closes.
 * @returns A ReadableStream of HTML bytes with hydration markers
 */
export async function renderSsrStream(
  element: ReactNode,
  options?: { bootstrapScriptContent?: string; deferSuspenseFor?: number; signal?: AbortSignal }
): Promise<ReadableStream<Uint8Array>> {
  const signal = options?.signal;
  const stream = await renderToReadableStream(element, {
    bootstrapScriptContent: options?.bootstrapScriptContent || undefined,
    signal,
    onError(error: unknown) {
      // Suppress logging for connection aborts — the user refreshed or
      // navigated away, not an application error.
      if (isAbortError(error) || signal?.aborted) return;
      console.error('[timber] SSR render error:', formatSsrError(error));
    },
  });

  // Prevent unhandled promise rejection from streaming-phase errors.
  // React DOM Server exposes `allReady` — a promise that resolves when
  // ALL content (including Suspense boundaries) has been rendered. If a
  // streaming-phase error occurs (e.g. React boundary flush failure),
  // `allReady` rejects independently of the stream. Without this catch,
  // the rejection becomes an unhandled promise rejection that crashes
  // the Node.js process.
  stream.allReady.catch(() => {});

  // deferSuspenseFor hold: delay the first read so React can resolve
  // fast-completing Suspense boundaries before we read the shell HTML.
  // renderToReadableStream generates HTML lazily on pull — if we wait
  // before reading, React resolves pending boundaries and inlines their
  // content instead of serializing fallbacks. Race allReady against
  // deferSuspenseFor so we don't wait longer than necessary.
  // See design/05-streaming.md §"deferSuspenseFor"
  const deferMs = options?.deferSuspenseFor;
  if (deferMs && deferMs > 0) {
    await Promise.race([
      stream.allReady,
      new Promise<void>((resolve) => setTimeout(resolve, deferMs)),
    ]);
  }

  // renderToReadableStream resolves after onShellReady by default.
  // The stream is ready to read — the shell (everything outside
  // Suspense boundaries) is available. Suspense content streams
  // into the open connection as it resolves.
  //
  // Wrap the stream in an error-resilient transform. With progressive
  // streaming, errors inside Suspense boundaries (e.g. deny() or throws
  // in async components) cause React's stream to error during the flush
  // phase. The onError callback logs the error, but the stream error
  // would become an unhandled promise rejection and crash the process.
  // The transform catches these post-shell streaming errors and closes
  // the stream cleanly — the shell (with correct status code) has
  // already been sent.
  return wrapStreamWithErrorHandling(stream, signal);
}

/**
 * Wrap an HTML stream with error handling for the streaming phase.
 *
 * During progressive RSC→SSR streaming, errors in Suspense boundaries
 * (e.g. deny() inside Suspense, throws in async components) cause
 * React DOM's renderToReadableStream to error after the shell has been
 * flushed. Without this wrapper, the stream error becomes an unhandled
 * promise rejection that crashes the process.
 *
 * The wrapper catches streaming-phase errors, logs them, and closes
 * the output stream cleanly. The shell (headers, status code, content
 * outside Suspense) has already been sent to the client.
 */
/** @internal Exported for testing only. */
export function wrapStreamWithErrorHandling(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        // Connection abort (user refreshed or navigated away) — close
        // silently without logging. This is not an application error.
        if (isAbortError(error) || signal?.aborted) {
          controller.close();
          return;
        }
        // Streaming-phase error (e.g. React boundary flush failure,
        // deny() or throw inside Suspense after flush).
        // The shell has already been sent with status 200. Inject a
        // noindex meta tag so search engines don't index this error page,
        // then close cleanly. See design/05-streaming.md.
        console.error('[timber] SSR streaming error (post-shell):', formatSsrError(error));
        controller.enqueue(encoder.encode(NOINDEX_SCRIPT));
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

/**
 * Check if an error is an abort error (connection closed by client).
 *
 * When the browser aborts a request (page refresh, navigation away),
 * the AbortSignal fires and React/streams throw an AbortError. This
 * is not an application error — suppress it from error boundaries and logs.
 */
function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

/**
 * Build a Response from the SSR HTML stream with the correct
 * status code and headers from the navigation context.
 *
 * Sets content-type to text/html if not already set by middleware.
 *
 * @param htmlStream - The HTML stream from renderSsrStream
 * @param statusCode - The committed HTTP status code from RSC
 * @param responseHeaders - Response headers from middleware/proxy
 * @returns A Response ready to send to the client
 */
export function buildSsrResponse(
  htmlStream: ReadableStream<Uint8Array>,
  statusCode: number,
  responseHeaders: Headers
): Response {
  if (!responseHeaders.has('content-type')) {
    responseHeaders.set('content-type', 'text/html; charset=utf-8');
  }

  return new Response(htmlStream, {
    status: statusCode,
    headers: responseHeaders,
  });
}
