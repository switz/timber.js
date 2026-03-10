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

/**
 * Render a React element tree to a ReadableStream of HTML.
 *
 * Uses renderToReadableStream (NOT renderToString) for streaming SSR.
 * The returned stream begins yielding after onShellReady — everything
 * outside <Suspense> boundaries is in the shell.
 *
 * @param element - The React element tree decoded from the RSC stream
 * @returns A ReadableStream of HTML bytes with hydration markers
 */
export async function renderSsrStream(
  element: ReactNode
): Promise<ReadableStream<Uint8Array>> {
  const stream = await renderToReadableStream(element, {
    onError(error: unknown) {
      // DenySignal errors are expected control flow — don't log them.
      // They arrive as deserialized errors from the RSC Flight stream
      // with the message pattern "Access denied with status NNN".
      if (
        error instanceof Error &&
        error.message.match(/^Access denied with status \d+$/)
      ) {
        return;
      }
      console.error('[timber] SSR render error:', error);
    },
  });

  // renderToReadableStream resolves after onShellReady by default.
  // The stream is ready to read — the shell (everything outside
  // Suspense boundaries) is available. Suspense content streams
  // into the open connection as it resolves.
  return stream;
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
