/**
 * RSC Stream Renderer — Creates the RSC Flight stream with signal tracking.
 *
 * Wraps `renderToReadableStream` from `@vitejs/plugin-rsc/rsc` and captures
 * render-phase signals (DenySignal, RedirectSignal, RenderError) thrown by
 * components during streaming. These signals are tracked in a shared
 * `RenderSignals` object so the caller can decide the HTTP response.
 *
 * Design docs: 02-rendering-pipeline.md §"Single-Pass Rendering",
 *              13-security.md §"Errors don't leak"
 */

import { renderToReadableStream } from '#/rsc-runtime/rsc.js';

import { logRenderError } from '#/server/logger.js';
import { DenySignal, RedirectSignal, RenderError } from '#/server/primitives.js';
import { checkAndWarnRscPropError } from '#/server/rsc-prop-warnings.js';

import { createDebugChannelSink, isAbortError } from './helpers.js';

/**
 * Mutable signal state captured during RSC rendering.
 *
 * Signals fire asynchronously via `onError` during stream consumption.
 * The first signal of each type wins — subsequent signals are ignored.
 */
export interface RenderSignals {
  denySignal: DenySignal | null;
  redirectSignal: RedirectSignal | null;
  renderError: { error: unknown; status: number } | null;
}

export interface RscStreamResult {
  rscStream: ReadableStream<Uint8Array> | undefined;
  signals: RenderSignals;
}

/**
 * Render a React element tree to an RSC Flight stream.
 *
 * The stream serializes server components as rendered output and client
 * components ("use client") as serialized references with module ID + export name.
 *
 * DenySignal detection: deny() in sync components throws during
 * renderToReadableStream (caught in try/catch). deny() in async components
 * fires onError during stream consumption. Signals are captured in the
 * returned `signals` object for the caller to handle.
 */
export function renderRscStream(
  element: React.ReactElement,
  req: Request
): RscStreamResult {
  const signals: RenderSignals = {
    denySignal: null,
    redirectSignal: null,
    renderError: null,
  };

  let rscStream: ReadableStream<Uint8Array> | undefined;

  try {
    rscStream = renderToReadableStream(
      element,
      {
        signal: req.signal,
        onError(error: unknown) {
          // Connection abort (user refreshed or navigated away) — suppress.
          // Not an application error; no need to track or log.
          if (isAbortError(error) || req.signal?.aborted) return;
          if (error instanceof DenySignal) {
            signals.denySignal = error;
            // Return structured digest for client-side error boundaries
            return JSON.stringify({ type: 'deny', status: error.status, data: error.data });
          }
          if (error instanceof RedirectSignal) {
            signals.redirectSignal = error;
            return JSON.stringify({
              type: 'redirect',
              location: error.location,
              status: error.status,
            });
          }
          if (error instanceof RenderError) {
            // Track the first render error for pre-flush handling
            if (!signals.renderError) {
              signals.renderError = { error, status: error.status };
            }
            logRenderError({ method: req.method, path: new URL(req.url).pathname, error });
            return JSON.stringify({
              type: 'render-error',
              code: error.code,
              data: error.digest.data,
              status: error.status,
            });
          }
          // Dev diagnostic: detect "Invalid hook call" errors which indicate
          // a 'use client' component is being executed during RSC rendering
          // instead of being serialized as a client reference. This happens when
          // the RSC plugin's transform doesn't detect the directive — e.g., the
          // directive isn't at the very top of the file, or the component is
          // re-exported through a barrel file without 'use client'.
          // See LOCAL-297.
          if (
            process.env.NODE_ENV !== 'production' &&
            error instanceof Error &&
            error.message.includes('Invalid hook call')
          ) {
            console.error(
              '[timber] A React hook was called during RSC rendering. This usually means a ' +
                "'use client' component is being executed as a server component instead of " +
                'being serialized as a client reference.\n\n' +
                'Common causes:\n' +
                "  1. The 'use client' directive is not the FIRST statement in the file (before any imports)\n" +
                "  2. The component is re-exported through a barrel file (index.ts) that lacks 'use client'\n" +
                '  3. @vitejs/plugin-rsc is not loaded or is misconfigured\n\n' +
                `Request: ${req.method} ${new URL(req.url).pathname}`
            );
          }

          // Dev-mode: detect non-serializable RSC props and provide
          // actionable fix suggestions (TIM-358).
          // checkAndWarnRscPropError no-ops in production internally.
          if (error instanceof Error) {
            checkAndWarnRscPropError(error, new URL(req.url).pathname);
          }

          // Track unhandled errors for pre-flush handling (500 status)
          if (!signals.renderError) {
            signals.renderError = { error, status: 500 };
          }
          logRenderError({ method: req.method, path: new URL(req.url).pathname, error });
        },
        debugChannel: createDebugChannelSink(),
      },
      {
        onClientReference(info: { id: string; name: string; deps: unknown }) {
          // Client reference callback — invoked when a "use client"
          // component is serialized into the RSC stream. Can be extended
          // for CSS dep collection and Early Hints.
          void info;
        },
      }
    );
  } catch (error) {
    if (error instanceof DenySignal) {
      signals.denySignal = error;
    } else if (error instanceof RedirectSignal) {
      signals.redirectSignal = error;
    } else {
      // Synchronous render error — component threw during
      // renderToReadableStream creation. Capture instead of crashing
      // the server; the error page will be rendered below.
      signals.renderError = {
        error,
        status: error instanceof RenderError ? error.status : 500,
      };
      logRenderError({ method: req.method, path: new URL(req.url).pathname, error });
    }
  }

  return { rscStream, signals };
}
