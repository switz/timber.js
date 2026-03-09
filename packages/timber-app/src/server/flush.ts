/**
 * Flush controller for timber.js rendering.
 *
 * Holds the response until `onShellReady` fires, then commits the HTTP status
 * code and flushes the shell. Render-phase signals (deny, redirect, unhandled
 * throws) caught before flush produce correct HTTP status codes.
 *
 * See design/02-rendering-pipeline.md §"The Flush Point" and §"The Hold Window"
 */

import { DenySignal, RedirectSignal, RenderError } from './primitives.js'

// ─── Types ───────────────────────────────────────────────────────────────────

/** The readable stream from React's renderToReadableStream. */
export interface ReactRenderStream {
  /** The underlying ReadableStream of HTML bytes. */
  readable: ReadableStream<Uint8Array>
  /** Resolves when the shell has finished rendering (all non-Suspense content). */
  allReady?: Promise<void>
}

/** Options for the flush controller. */
export interface FlushOptions {
  /** Response headers to include (from middleware.ts, proxy.ts, etc.). */
  responseHeaders?: Headers
  /** Default status code when rendering succeeds. Default: 200. */
  defaultStatus?: number
}

/** Result of the flush process. */
export interface FlushResult {
  /** The final HTTP Response. */
  response: Response
  /** The status code committed. */
  status: number
  /** Whether the response was a redirect. */
  isRedirect: boolean
  /** Whether the response was a denial. */
  isDenial: boolean
}

// ─── Render Function Type ────────────────────────────────────────────────────

/**
 * A function that performs the React render.
 *
 * The flush controller calls this, catches any signals thrown during the
 * synchronous shell render (before onShellReady), and produces the
 * correct HTTP response.
 *
 * Must return an object with:
 * - `stream`: The ReadableStream from renderToReadableStream
 * - `shellReady`: A Promise that resolves when onShellReady fires
 */
export interface RenderResult {
  /** The HTML byte stream. */
  stream: ReadableStream<Uint8Array>
  /** Resolves when the shell is ready (all non-Suspense content rendered). */
  shellReady: Promise<void>
}

export type RenderFn = () => RenderResult | Promise<RenderResult>

// ─── Flush Controller ────────────────────────────────────────────────────────

/**
 * Execute a render and hold the response until the shell is ready.
 *
 * The flush controller:
 * 1. Calls the render function to start renderToReadableStream
 * 2. Waits for shellReady (onShellReady)
 * 3. If a render-phase signal was thrown (deny, redirect, error), produces
 *    the correct HTTP status code
 * 4. If the shell rendered successfully, commits the status and streams
 *
 * Render-phase signals caught before flush:
 * - `DenySignal` → HTTP 4xx with appropriate status code
 * - `RedirectSignal` → HTTP 3xx with Location header
 * - `RenderError` → HTTP status from error (default 500)
 * - Unhandled error → HTTP 500
 *
 * @param renderFn - Function that starts the React render.
 * @param options - Flush configuration.
 * @returns The committed HTTP Response.
 */
export async function flushResponse(
  renderFn: RenderFn,
  options: FlushOptions = {},
): Promise<FlushResult> {
  const { responseHeaders = new Headers(), defaultStatus = 200 } = options

  let renderResult: RenderResult

  // Phase 1: Start the render. The render function may throw synchronously
  // if there's an immediate error before React even starts.
  try {
    renderResult = await renderFn()
  } catch (error) {
    return handleSignal(error, responseHeaders)
  }

  // Phase 2: Wait for onShellReady. Render-phase signals (deny, redirect,
  // throws outside Suspense) are caught here.
  try {
    await renderResult.shellReady
  } catch (error) {
    return handleSignal(error, responseHeaders)
  }

  // Phase 3: Shell rendered successfully. Commit status and stream.
  responseHeaders.set('Content-Type', 'text/html; charset=utf-8')

  return {
    response: new Response(renderResult.stream, {
      status: defaultStatus,
      headers: responseHeaders,
    }),
    status: defaultStatus,
    isRedirect: false,
    isDenial: false,
  }
}

// ─── Signal Handling ─────────────────────────────────────────────────────────

/**
 * Handle a render-phase signal and produce the correct HTTP response.
 */
function handleSignal(error: unknown, responseHeaders: Headers): FlushResult {
  // Redirect signal → HTTP 3xx
  if (error instanceof RedirectSignal) {
    responseHeaders.set('Location', error.location)
    return {
      response: new Response(null, {
        status: error.status,
        headers: responseHeaders,
      }),
      status: error.status,
      isRedirect: true,
      isDenial: false,
    }
  }

  // Deny signal → HTTP 4xx
  if (error instanceof DenySignal) {
    return {
      response: new Response(null, {
        status: error.status,
        headers: responseHeaders,
      }),
      status: error.status,
      isRedirect: false,
      isDenial: true,
    }
  }

  // RenderError → HTTP status from error
  if (error instanceof RenderError) {
    return {
      response: new Response(null, {
        status: error.status,
        headers: responseHeaders,
      }),
      status: error.status,
      isRedirect: false,
      isDenial: false,
    }
  }

  // Unknown error → HTTP 500
  console.error('[timber] Unhandled render-phase error:', error)
  return {
    response: new Response(null, {
      status: 500,
      headers: responseHeaders,
    }),
    status: 500,
    isRedirect: false,
    isDenial: false,
  }
}
