/**
 * SSR Renderer — Pipes the RSC stream through SSR to produce HTML.
 *
 * Tees the RSC stream into two copies:
 * 1. SSR stream — decoded and rendered to HTML
 * 2. Inline stream — embedded as progressive <script> tags for hydration
 *
 * Handles signal promotion (redirect/deny discovered during SSR) and
 * SSR shell failures (errors outside Suspense boundaries).
 *
 * Design docs: 02-rendering-pipeline.md §"RSC → SSR → Client Hydration",
 *              05-streaming.md §"deferSuspenseFor and the Hold Window"
 */

import type { ClientBootstrapConfig } from '#/server/html-injectors.js';
import type { LayoutEntry } from '#/server/deny-renderer.js';
import { renderDenyPage } from '#/server/deny-renderer.js';
import type { RouteMatch } from '#/server/pipeline.js';
import { SsrStreamError } from '#/server/primitives.js';
import type { LayoutComponentEntry } from '#/server/route-element-builder.js';
import type { ManifestSegmentNode } from '#/server/route-matcher.js';
import type { NavContext } from '#/server/ssr-entry.js';

import {
  buildRedirectResponse,
  buildSegmentInfo,
  createDebugChannelSink,
  isAbortError,
  parseCookiesFromHeader,
} from './helpers.js';
import { renderErrorPage } from './error-renderer.js';
import { callSsr } from './ssr-bridge.js';
import type { RenderSignals } from './rsc-stream.js';

interface SsrRenderOptions {
  req: Request;
  rscStream: ReadableStream<Uint8Array>;
  signals: RenderSignals;
  segments: ManifestSegmentNode[];
  layoutComponents: LayoutComponentEntry[];
  match: RouteMatch;
  responseHeaders: Headers;
  clientBootstrap: ClientBootstrapConfig;
  clientJsDisabled: boolean;
  headHtml: string;
  deferSuspenseFor: number;
}

/**
 * Render the RSC stream to HTML via SSR.
 *
 * Progressive streaming: pipes the RSC stream directly to SSR without
 * buffering. This enables proper Suspense streaming behavior.
 *
 * For async deny() (inside components that await before calling deny()),
 * SSR will attempt to render the element tree progressively. Two outcomes:
 *
 * 1. deny() outside Suspense: the error appears in the RSC shell. SSR's
 *    renderToReadableStream fails (rejects). We catch the failure, check
 *    denySignal, and render the deny page with the correct status code.
 *
 * 2. deny() inside Suspense: the SSR shell succeeds (200 committed). The
 *    error streams into the connection as a React error boundary. The
 *    status is already committed — per design/05-streaming.md this is the
 *    expected degraded behavior for deny inside Suspense.
 */
export async function renderSsrResponse(opts: SsrRenderOptions): Promise<Response> {
  const {
    req,
    rscStream,
    signals,
    segments,
    layoutComponents,
    match,
    responseHeaders,
    clientBootstrap,
    clientJsDisabled,
    headHtml,
    deferSuspenseFor,
  } = opts;

  // Tee the RSC stream — one copy goes to SSR for HTML rendering,
  // the other is inlined in the HTML for client-side hydration.
  const [ssrStream, inlineStream] = rscStream.tee();

  // Embed segment metadata in HTML for initial hydration.
  // The client reads this to populate its segment cache before the
  // first navigation, enabling state tree diffing from the start.
  // Skipped when client JS is disabled — no client JS to consume it.
  const segmentScript = clientJsDisabled
    ? ''
    : `<script>self.__timber_segments=${JSON.stringify(buildSegmentInfo(segments, layoutComponents))}</script>`;

  // Embed route params in HTML so useParams() works on initial hydration.
  // Without this, useParams() returns {} until the first client navigation.
  const paramsScript =
    clientJsDisabled || Object.keys(match.params).length === 0
      ? ''
      : `<script>self.__timber_params=${JSON.stringify(match.params)}</script>`;

  const navContext: NavContext = {
    pathname: new URL(req.url).pathname,
    params: match.params,
    searchParams: Object.fromEntries(new URL(req.url).searchParams),
    statusCode: 200,
    responseHeaders,
    headHtml: headHtml + clientBootstrap.preloadLinks + segmentScript + paramsScript,
    bootstrapScriptContent: clientBootstrap.bootstrapScriptContent,
    // Skip RSC inline stream when client JS is disabled — no client to hydrate.
    rscStream: clientJsDisabled ? undefined : inlineStream,
    deferSuspenseFor: deferSuspenseFor > 0 ? deferSuspenseFor : undefined,
    signal: req.signal,
    cookies: parseCookiesFromHeader(req.headers.get('cookie') ?? ''),
  };

  // Helper: check if render-phase signals were captured and return the
  // appropriate HTTP response. Used after both successful SSR (signal
  // promotion from Suspense) and failed SSR (signal outside Suspense).
  //
  // When `skipHandledDeny` is true (SSR success path), skip DenySignal
  // promotion if the denial was already handled by a TimberErrorBoundary
  // (e.g., slot error boundary). The boundary sets navContext._denyHandledByBoundary
  // during SSR rendering. See LOCAL-298.
  function checkCapturedSignals(
    skipHandledDeny = false
  ): Response | Promise<Response> | null {
    if (signals.redirectSignal) {
      return buildRedirectResponse(req, signals.redirectSignal, responseHeaders);
    }
    if (signals.denySignal && !(skipHandledDeny && navContext._denyHandledByBoundary)) {
      return renderDenyPage(
        signals.denySignal,
        segments,
        layoutComponents as LayoutEntry[],
        req,
        match,
        responseHeaders,
        clientBootstrap,
        createDebugChannelSink,
        callSsr
      );
    }
    if (signals.renderError) {
      return renderErrorPage(
        signals.renderError.error,
        signals.renderError.status,
        segments,
        layoutComponents as LayoutEntry[],
        req,
        match,
        responseHeaders,
        clientBootstrap
      );
    }
    return null;
  }

  try {
    const ssrResponse = await callSsr(ssrStream, navContext);

    // Signal promotion: yield one tick so async component rejections
    // propagate to the RSC onError callback, then check if any signals
    // were captured during rendering inside Suspense boundaries.
    // The Response hasn't been sent yet — it's an unconsumed stream.
    // See design/05-streaming.md §"deferSuspenseFor and the Hold Window"
    await new Promise<void>((r) => setTimeout(r, 0));

    const promoted = checkCapturedSignals(/* skipHandledDeny */ true);
    if (promoted) {
      ssrResponse.body?.cancel();
      return promoted;
    }
    return ssrResponse;
  } catch (ssrError) {
    // Connection abort — the client disconnected (page refresh, navigation
    // away). No response needed; return empty 499 (client closed request).
    if (isAbortError(ssrError) || req.signal?.aborted) {
      return new Response(null, { status: 499 });
    }

    // SsrStreamError: SSR's renderToReadableStream failed because the RSC
    // stream contained an uncontained error (e.g., slot without error boundary).
    // Render the deny/error page WITHOUT layout wrapping to avoid re-executing
    // server components (which call headers()/cookies() and fail in SSR's
    // separate ALS scope). See LOCAL-293.
    if (ssrError instanceof SsrStreamError) {
      if (signals.redirectSignal) {
        return buildRedirectResponse(req, signals.redirectSignal, responseHeaders);
      }
      if (signals.denySignal) {
        // Render deny page without layouts — pass empty layout list
        return renderDenyPage(
          signals.denySignal,
          segments,
          [] as LayoutEntry[],
          req,
          match,
          responseHeaders,
          clientBootstrap,
          createDebugChannelSink,
          callSsr
        );
      }
      if (signals.renderError) {
        return renderErrorPage(
          signals.renderError.error,
          signals.renderError.status,
          segments,
          [] as LayoutEntry[],
          req,
          match,
          responseHeaders,
          clientBootstrap
        );
      }
      // No captured signal — return bare 500
      return new Response(null, { status: 500, headers: responseHeaders });
    }

    // SSR shell rendering failed — the error was outside Suspense.
    // Check captured signals (redirect, deny, render error).
    const signalResponse = checkCapturedSignals();
    if (signalResponse) return signalResponse;

    // No tracked error — rethrow (infrastructure failure)
    throw ssrError;
  }
}
