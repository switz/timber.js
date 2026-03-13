/// <reference types="@vitejs/plugin-rsc/types" />

/**
 * RSC Entry — Request handler for the RSC environment.
 *
 * This is a real TypeScript file, not codegen. It imports the route
 * manifest from a virtual module and creates the request handler.
 *
 * The RSC entry renders the React element tree into an RSC Flight stream
 * using @vitejs/plugin-rsc/rsc. This stream encodes server components as
 * rendered output and client components ("use client") as serialized
 * references. The stream is then passed to the SSR entry (in a separate
 * Vite environment) which decodes it and renders HTML.
 *
 * Design docs: 18-build-system.md §"Entry Files", 02-rendering-pipeline.md
 */

// @ts-expect-error — virtual module provided by timber-routing plugin
import routeManifest from 'virtual:timber-route-manifest';
// @ts-expect-error — virtual module provided by timber-entries plugin
import config from 'virtual:timber-config';
// @ts-expect-error — virtual module provided by timber-build-manifest plugin
import buildManifest from 'virtual:timber-build-manifest';

import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc';

import { createPipeline } from '@/server/pipeline.js';
import { initDevTracing } from '@/server/tracing.js';
import type { PipelineConfig, RouteMatch, InterceptionContext } from '@/server/pipeline.js';
import { logRenderError } from '@/server/logger.js';
import { resolveLogMode } from '@/server/dev-logger.js';
import { createRouteMatcher } from '@/server/route-matcher.js';
import type { ManifestSegmentNode } from '@/server/route-matcher.js';
import { DenySignal, RedirectSignal, RenderError } from '@/server/primitives.js';
import { buildClientScripts } from '@/server/html-injectors.js';
import type { ClientBootstrapConfig } from '@/server/html-injectors.js';
import { renderDenyPage, renderDenyPageAsRsc } from '@/server/deny-renderer.js';
import type { LayoutEntry } from '@/server/deny-renderer.js';
import {
  collectRouteCss,
  collectRouteFonts,
  collectRouteModulepreloads,
  buildCssLinkTags,
  buildFontPreloadTags,
  buildModulepreloadTags,
} from '@/server/build-manifest.js';
import type { BuildManifest } from '@/server/build-manifest.js';
import { collectEarlyHintHeaders } from '@/server/early-hints.js';
import { sendEarlyHints103 } from '@/server/early-hints-sender.js';
import type { NavContext } from '@/server/ssr-entry.js';
import { buildRouteElement, RouteSignalWithContext } from '@/server/route-element-builder.js';
import { isActionRequest, handleActionRequest } from '@/server/action-handler.js';
import type { FormRerender } from '@/server/action-handler.js';
import type { BodyLimitsConfig } from '@/server/body-limits.js';
import { runWithFormFlash } from '@/server/form-flash.js';

import {
  createDebugChannelSink,
  buildSegmentInfo,
  isRscPayloadRequest,
  buildRedirectResponse,
  escapeHtml,
  isAbortError,
  RSC_CONTENT_TYPE,
} from './helpers.js';
import { handleApiRoute } from './api-handler.js';
import { renderErrorPage, renderNoMatchPage } from './error-renderer.js';
import { callSsr } from './ssr-bridge.js';

// Dev-only pipeline error handler, set by the dev server after import.
// In production this is always undefined — no overhead.
let _devPipelineErrorHandler: ((error: Error, phase: string) => void) | undefined;

/**
 * Set the dev pipeline error handler.
 *
 * Called by the dev server after importing this module to wire pipeline
 * errors into the Vite browser error overlay. No-op in production.
 */
export function setDevPipelineErrorHandler(handler: (error: Error, phase: string) => void): void {
  _devPipelineErrorHandler = handler;
}

/**
 * Create the RSC request handler from the route manifest.
 *
 * The pipeline handles: proxy.ts → canonicalize → route match →
 * 103 Early Hints → middleware.ts → render (RSC → SSR → HTML).
 */
async function createRequestHandler(manifest: typeof routeManifest, runtimeConfig: typeof config) {
  const matchRoute = createRouteMatcher(manifest);

  // Build the client bootstrap configuration.
  // When client JavaScript is disabled, no scripts are injected
  // (unless enableHMRInDev is true in dev mode — then only HMR client).
  // In production, uses hashed chunk URLs from the build manifest.
  const clientJsConfig = (runtimeConfig as Record<string, unknown>).clientJavascript as
    | { disabled: boolean; enableHMRInDev: boolean }
    | undefined;
  const clientJsDisabled = clientJsConfig?.disabled ?? false;
  const clientBootstrap = buildClientScripts({
    ...runtimeConfig,
    clientJavascript: clientJsConfig ?? { disabled: false, enableHMRInDev: false },
    buildManifest: buildManifest as BuildManifest,
  });

  // Dev logging — initialize OTEL-based dev tracing once at handler creation.
  // In production, isDev is false — no tracing, no overhead.
  // The DevSpanProcessor handles all formatting and stderr output.
  const isDev = process.env.NODE_ENV !== 'production';
  const slowPhaseMs = (runtimeConfig as Record<string, unknown>).slowPhaseMs as number | undefined;

  if (isDev) {
    const devLogMode = resolveLogMode();
    if (devLogMode !== 'quiet') {
      await initDevTracing({ mode: devLogMode, slowPhaseMs });
    }
  }

  const typedBuildManifest = buildManifest as BuildManifest;

  const pipelineConfig: PipelineConfig = {
    proxy: manifest.proxy?.load,
    matchRoute,
    // 103 Early Hints — fires after route match, before middleware.
    // Collects CSS, font, and JS chunk Link headers from the build manifest
    // so the browser starts fetching critical resources while the server renders.
    // In dev mode the manifest is empty — no hints are sent.
    earlyHints: (match: RouteMatch, _req: Request, responseHeaders: Headers) => {
      const segments = match.segments as unknown as Array<{
        layout?: { filePath: string };
        page?: { filePath: string };
      }>;
      const headers = collectEarlyHintHeaders(segments, typedBuildManifest, {
        skipJs: clientJsDisabled,
      });
      for (const h of headers) {
        responseHeaders.append('Link', h);
      }
      // Send 103 Early Hints if the platform supports it (Node.js, Bun).
      // On Cloudflare, the CDN converts Link headers into 103 automatically.
      sendEarlyHints103(headers);
    },
    render: async (
      req: Request,
      match: RouteMatch,
      responseHeaders: Headers,
      _requestHeaderOverlay: Headers,
      interception?: InterceptionContext
    ) => {
      return renderRoute(
        req,
        match,
        responseHeaders,
        clientBootstrap,
        clientJsDisabled,
        interception
      );
    },
    renderNoMatch: async (req: Request, responseHeaders: Headers) => {
      return renderNoMatchPage(req, manifest.root, responseHeaders, clientBootstrap);
    },
    interceptionRewrites: manifest.interceptionRewrites,
    onPipelineError: isDev
      ? (error: Error, phase: string) => {
          if (_devPipelineErrorHandler) _devPipelineErrorHandler(error, phase);
        }
      : undefined,
  };

  const pipeline = createPipeline(pipelineConfig);

  // Wrap the pipeline to intercept server action requests before rendering.
  // Actions bypass the normal pipeline (no route matching, no middleware)
  // per design/08-forms-and-actions.md §"Middleware for Server Actions".
  const csrfConfig = {
    csrf: runtimeConfig.csrf,
    allowedOrigins: (runtimeConfig as Record<string, unknown>).allowedOrigins as
      | string[]
      | undefined,
  };

  return async (req: Request): Promise<Response> => {
    if (isActionRequest(req)) {
      const actionResponse = await handleActionRequest(req, {
        csrf: csrfConfig,
        bodyLimits: {
          limits: (runtimeConfig as Record<string, unknown>).limits as BodyLimitsConfig['limits'],
        },
        revalidateRenderer: async (path: string) => {
          // Build the React element tree for the route at `path`.
          // Returns the element tree (not serialized) so the action handler can
          // combine it with the action result in a single renderToReadableStream call.
          // Forward original request headers (cookies, session IDs, etc.).
          const revalidateHeaders = new Headers(req.headers);
          revalidateHeaders.set('Accept', 'text/x-component');
          const revalidateReq = new Request(new URL(path, req.url), {
            headers: revalidateHeaders,
          });
          const revalidateMatch = matchRoute(new URL(revalidateReq.url).pathname);
          if (!revalidateMatch) {
            throw new Error(`revalidatePath('${path}') — no matching route`);
          }
          const routeResult = await buildRouteElement(revalidateReq, revalidateMatch);
          return {
            element: routeResult.element,
            headElements: routeResult.headElements,
          };
        },
      });
      if (actionResponse) {
        // Check if this is a re-render signal (no-JS validation failure)
        if ('rerender' in actionResponse) {
          const formRerender = actionResponse as FormRerender;
          // Re-render the page with the action result as flash data.
          // Server components read it via getFormFlash() and pass it to
          // client form components as the initial useActionState value.
          const response = await runWithFormFlash(formRerender.rerender, () => pipeline(req));
          return response;
        }
        return actionResponse;
      }
    }
    return pipeline(req);
  };
}

/**
 * Render a matched route to an HTML Response via RSC → SSR pipeline,
 * or return a raw RSC Flight stream for client-side navigation requests.
 *
 * 1. Load page/layout components from the segment chain
 * 2. Resolve metadata
 * 3. Render to RSC Flight stream (serializes "use client" as references)
 * 4. If Accept: text/x-component → return RSC stream directly
 *    Otherwise → pass RSC stream to SSR entry for HTML rendering
 */
async function renderRoute(
  _req: Request,
  match: RouteMatch,
  responseHeaders: Headers,
  clientBootstrap: ClientBootstrapConfig,
  clientJsDisabled: boolean,
  interception?: InterceptionContext
): Promise<Response> {
  const segments = match.segments as unknown as ManifestSegmentNode[];
  const leaf = segments[segments.length - 1];

  // API routes (route.ts) — run access.ts standalone then dispatch to handler.
  // No React render pass — AccessGate is not used, React.cache is not active.
  // See design/04-authorization.md §"Auth in API Routes".
  if (leaf.route && !leaf.page) {
    return handleApiRoute(_req, match, segments, responseHeaders);
  }

  // Build the React element tree — loads modules, runs access checks,
  // resolves metadata. DenySignal/RedirectSignal propagate for HTTP handling.
  let routeResult;
  try {
    routeResult = await buildRouteElement(_req, match, interception);
  } catch (error) {
    // RouteSignalWithContext wraps DenySignal/RedirectSignal with layout context
    if (error instanceof RouteSignalWithContext) {
      const { signal, layoutComponents: lc, segments: segs } = error;
      if (signal instanceof DenySignal) {
        if (isRscPayloadRequest(_req)) {
          return renderDenyPageAsRsc(
            signal,
            segs,
            lc as LayoutEntry[],
            responseHeaders,
            createDebugChannelSink
          );
        }
        return renderDenyPage(
          signal,
          segs,
          lc as LayoutEntry[],
          _req,
          match,
          responseHeaders,
          clientBootstrap,
          createDebugChannelSink,
          callSsr
        );
      }
      if (signal instanceof RedirectSignal) {
        return buildRedirectResponse(_req, signal, responseHeaders);
      }
    }
    // No PageComponent found
    if (error instanceof Error && error.message.startsWith('No page component')) {
      return new Response(null, { status: 404 });
    }
    throw error;
  }

  const { element, headElements, layoutComponents, deferSuspenseFor } = routeResult;

  // Build head HTML for injection into the SSR output
  let headHtml = '';

  // Collect CSS, fonts, and modulepreload from the build manifest for matched segments.
  // In dev mode the manifest is empty — Vite HMR handles CSS/JS.
  //
  // Link headers (for 103 Early Hints) are emitted by the earlyHints pipeline
  // stage before middleware runs. Here we only emit the <head> HTML fallback tags
  // — these ensure resources load even on platforms without Early Hints support.
  const typedManifest = buildManifest as BuildManifest;
  const cssUrls = collectRouteCss(segments, typedManifest);
  if (cssUrls.length > 0) {
    headHtml += buildCssLinkTags(cssUrls);
  }

  const fontEntries = collectRouteFonts(segments, typedManifest);
  if (fontEntries.length > 0) {
    headHtml += buildFontPreloadTags(fontEntries);
  }

  // Skip modulepreload tags when client JavaScript is disabled — no JS to preload.
  if (!clientJsDisabled) {
    const preloadUrls = collectRouteModulepreloads(segments, typedManifest);
    if (preloadUrls.length > 0) {
      headHtml += buildModulepreloadTags(preloadUrls);
    }
  }

  for (const el of headElements) {
    if (el.tag === 'title' && el.content) {
      headHtml += `<title>${escapeHtml(el.content)}</title>`;
    } else if (el.attrs) {
      const attrs = Object.entries(el.attrs)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}="${escapeHtml(v as string)}"`)
        .join(' ');
      headHtml += `<${el.tag} ${attrs}>`;
    }
  }

  // Render to RSC Flight stream.
  // renderToReadableStream from @vitejs/plugin-rsc/rsc serializes:
  // - Server components: rendered output (HTML-like structure)
  // - Client components ("use client"): serialized references with module ID + export name
  //
  // The RSC plugin's renderToReadableStream(data, reactOptions, extraOptions):
  // - reactOptions: passed to React (onError, signal, etc.)
  // - extraOptions: { onClientReference } for tracking client deps
  // The client manifest is created internally by the plugin.
  //
  // DenySignal detection: deny() in sync components throws during
  // renderToReadableStream (caught in try/catch). deny() in async components
  // fires onError during stream consumption. We capture it here and let
  // SSR determine whether it was pre-flush (outside Suspense) or post-flush
  // (inside Suspense) based on whether the SSR shell renders successfully.
  let denySignal: DenySignal | null = null;
  let redirectSignal: RedirectSignal | null = null;
  let renderError: { error: unknown; status: number } | null = null;
  let rscStream: ReadableStream<Uint8Array> | undefined;
  try {
    rscStream = renderToReadableStream(
      element,
      {
        signal: _req.signal,
        onError(error: unknown) {
          // Connection abort (user refreshed or navigated away) — suppress.
          // Not an application error; no need to track or log.
          if (isAbortError(error) || _req.signal?.aborted) return;
          if (error instanceof DenySignal) {
            denySignal = error;
            // Return structured digest for client-side error boundaries
            return JSON.stringify({ type: 'deny', status: error.status, data: error.data });
          }
          if (error instanceof RedirectSignal) {
            redirectSignal = error;
            return JSON.stringify({
              type: 'redirect',
              location: error.location,
              status: error.status,
            });
          }
          if (error instanceof RenderError) {
            // Track the first render error for pre-flush handling
            if (!renderError) {
              renderError = { error, status: error.status };
            }
            logRenderError({ method: _req.method, path: new URL(_req.url).pathname, error });
            return JSON.stringify({
              type: 'render-error',
              code: error.code,
              data: error.digest.data,
              status: error.status,
            });
          }
          // Track unhandled errors for pre-flush handling (500 status)
          if (!renderError) {
            renderError = { error, status: 500 };
          }
          logRenderError({ method: _req.method, path: new URL(_req.url).pathname, error });
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
      denySignal = error;
    } else if (error instanceof RedirectSignal) {
      redirectSignal = error;
    } else {
      // Synchronous render error — component threw during
      // renderToReadableStream creation. Capture instead of crashing
      // the server; the error page will be rendered below.
      renderError = {
        error,
        status: error instanceof RenderError ? error.status : 500,
      };
      logRenderError({ method: _req.method, path: new URL(_req.url).pathname, error });
    }
  }

  // Synchronous redirect — redirect() in access.ts or a non-async component
  // throws during renderToReadableStream creation. Return HTTP redirect.
  if (redirectSignal) {
    return buildRedirectResponse(_req, redirectSignal, responseHeaders);
  }

  // Synchronous deny — deny() in a non-async component throws during
  // renderToReadableStream creation, caught in the try/catch above.
  if (denySignal) {
    if (isRscPayloadRequest(_req)) {
      return renderDenyPageAsRsc(
        denySignal,
        segments,
        layoutComponents as LayoutEntry[],
        responseHeaders,
        createDebugChannelSink
      );
    }
    return renderDenyPage(
      denySignal,
      segments,
      layoutComponents as LayoutEntry[],
      _req,
      match,
      responseHeaders,
      clientBootstrap,
      createDebugChannelSink,
      callSsr
    );
  }

  // Synchronous render error — renderToReadableStream threw before
  // creating the stream. Render the error page with correct 5xx status.
  // (Async render errors are tracked in onError and handled after SSR.)
  if (renderError && !rscStream) {
    return renderErrorPage(
      renderError.error,
      renderError.status,
      segments,
      layoutComponents as LayoutEntry[],
      _req,
      match,
      responseHeaders,
      clientBootstrap
    );
  }

  // For RSC payload requests (client navigation), return the RSC Flight
  // stream directly — skip SSR HTML rendering entirely.
  // See design/19-client-navigation.md §"RSC Payload Handling"
  if (isRscPayloadRequest(_req)) {
    responseHeaders.set('content-type', `${RSC_CONTENT_TYPE}; charset=utf-8`);
    // Vary on Accept so CDNs cache HTML and RSC responses separately
    // for the same URL. The client appends ?_rsc=<id> as a cache-bust,
    // but Vary ensures correct behavior even without the query param.
    responseHeaders.set('Vary', 'Accept');

    // Send resolved head elements so the client can update document.title
    // and <meta> tags after SPA navigation. See design/16-metadata.md.
    const encoded = encodeURIComponent(JSON.stringify(headElements));
    if (encoded.length <= 4096) {
      responseHeaders.set('X-Timber-Head', encoded);
    }

    // Send segment metadata so the client can populate its segment cache
    // for state tree diffing on subsequent navigations.
    // See design/19-client-navigation.md §"X-Timber-State-Tree Header"
    const segmentInfo = buildSegmentInfo(segments, layoutComponents);
    responseHeaders.set('X-Timber-Segments', JSON.stringify(segmentInfo));

    // Send route params so the client can populate useParams() after
    // SPA navigation. Without this, useParams() returns {}.
    if (Object.keys(match.params).length > 0) {
      responseHeaders.set('X-Timber-Params', JSON.stringify(match.params));
    }

    return new Response(rscStream!, {
      status: 200,
      headers: responseHeaders,
    });
  }

  // Progressive streaming: pipe the RSC stream directly to SSR without
  // buffering. This enables proper Suspense streaming behavior.
  //
  // For async deny() (inside components that await before calling deny()),
  // SSR will attempt to render the element tree progressively. Two outcomes:
  //
  // 1. deny() outside Suspense: the error appears in the RSC shell. SSR's
  //    renderToReadableStream fails (rejects). We catch the failure, check
  //    denySignal, and render the deny page with the correct status code.
  //
  // 2. deny() inside Suspense: the SSR shell succeeds (200 committed). The
  //    error streams into the connection as a React error boundary. The
  //    status is already committed — per design/05-streaming.md this is the
  //    expected degraded behavior for deny inside Suspense.
  //
  // Tee the RSC stream — one copy goes to SSR for HTML rendering,
  // the other is inlined in the HTML for client-side hydration.
  const [ssrStream, inlineStream] = rscStream!.tee();

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
    pathname: new URL(_req.url).pathname,
    params: match.params,
    searchParams: Object.fromEntries(new URL(_req.url).searchParams),
    statusCode: 200,
    responseHeaders,
    headHtml: headHtml + clientBootstrap.preloadLinks + segmentScript + paramsScript,
    bootstrapScriptContent: clientBootstrap.bootstrapScriptContent,
    // Skip RSC inline stream when client JS is disabled — no client to hydrate.
    rscStream: clientJsDisabled ? undefined : inlineStream,
    deferSuspenseFor: deferSuspenseFor > 0 ? deferSuspenseFor : undefined,
    signal: _req.signal,
  };

  try {
    return await callSsr(ssrStream, navContext);
  } catch (ssrError) {
    // Connection abort — the client disconnected (page refresh, navigation
    // away). No response needed; return empty 499 (client closed request).
    if (isAbortError(ssrError) || _req.signal?.aborted) {
      return new Response(null, { status: 499 });
    }

    // SSR shell rendering failed — the error was outside Suspense
    // (inside Suspense errors stream after shell succeeds).

    // RedirectSignal outside Suspense → HTTP redirect
    // Note: redirectSignal is assigned inside onError callback — TS narrowing
    // doesn't track mutations in callbacks, so we cast.
    const trackedRedirect = redirectSignal as RedirectSignal | null;
    if (trackedRedirect) {
      return buildRedirectResponse(_req, trackedRedirect, responseHeaders);
    }

    // DenySignal outside Suspense → render deny page with correct 4xx status
    if (denySignal) {
      return renderDenyPage(
        denySignal,
        segments,
        layoutComponents as LayoutEntry[],
        _req,
        match,
        responseHeaders,
        clientBootstrap,
        createDebugChannelSink,
        callSsr
      );
    }

    // RenderError or unhandled throw outside Suspense → render error page
    // with the correct status code (RenderError.status or 500).
    // Note: renderError is assigned inside the onError callback — TS
    // narrowing doesn't track mutations in callbacks, so we cast.
    const trackedError = renderError as { error: unknown; status: number } | null;
    if (trackedError) {
      return renderErrorPage(
        trackedError.error,
        trackedError.status,
        segments,
        layoutComponents as LayoutEntry[],
        _req,
        match,
        responseHeaders,
        clientBootstrap
      );
    }

    // No tracked error — rethrow (infrastructure failure)
    throw ssrError;
  }
}

// Re-export for generated entry points (e.g., Nitro node-server/bun) to wrap
// the handler with per-request 103 Early Hints sender via ALS.
export { runWithEarlyHintsSender } from '@/server/early-hints-sender.js';

export default await createRequestHandler(routeManifest, config);
