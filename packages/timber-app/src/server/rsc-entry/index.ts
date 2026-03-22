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
// @ts-expect-error — virtual module provided by timber-entries plugin
import loadUserInstrumentation from 'virtual:timber-instrumentation';

import type { FormRerender } from '#/server/action-handler.js';
import { handleActionRequest, isActionRequest } from '#/server/action-handler.js';
import type { BodyLimitsConfig } from '#/server/body-limits.js';
import type { BuildManifest } from '#/server/build-manifest.js';
import {
  buildCssLinkTags,
  buildFontPreloadTags,
  buildModulepreloadTags,
  collectRouteCss,
  collectRouteFonts,
  collectRouteModulepreloads,
} from '#/server/build-manifest.js';
import type { LayoutEntry } from '#/server/deny-renderer.js';
import { renderDenyPage, renderDenyPageAsRsc } from '#/server/deny-renderer.js';
import { resolveLogMode } from '#/server/dev-logger.js';
import { sendEarlyHints103 } from '#/server/early-hints-sender.js';
import { collectEarlyHintHeaders } from '#/server/early-hints.js';
import { runWithFormFlash } from '#/server/form-flash.js';
import type { ClientBootstrapConfig } from '#/server/html-injectors.js';
import { buildClientScripts } from '#/server/html-injectors.js';
import type { InterceptionContext, PipelineConfig, RouteMatch } from '#/server/pipeline.js';
import { createPipeline } from '#/server/pipeline.js';
import { DenySignal, RedirectSignal } from '#/server/primitives.js';
import { buildRouteElement, RouteSignalWithContext } from '#/server/route-element-builder.js';
import type { ManifestSegmentNode } from '#/server/route-matcher.js';
import { createMetadataRouteMatcher, createRouteMatcher } from '#/server/route-matcher.js';
import { initDevTracing } from '#/server/tracing.js';

import { renderFallbackError as renderFallback } from '#/server/fallback-error.js';
import { loadInstrumentation } from '#/server/instrumentation.js';
import { handleApiRoute } from './api-handler.js';
import { renderErrorPage, renderNoMatchPage } from './error-renderer.js';
import {
  buildRedirectResponse,
  createDebugChannelSink,
  escapeHtml,
  isRscPayloadRequest,
} from './helpers.js';
import { parseClientStateTree } from '#/server/state-tree-diff.js';
import { buildRscPayloadResponse } from './rsc-payload.js';
import { renderRscStream } from './rsc-stream.js';
import { renderSsrResponse } from './ssr-renderer.js';
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
  // Load the user's instrumentation.ts — register() is awaited before the
  // server accepts any requests. The logger and onRequestError hooks are
  // wired into the framework. This runs once at startup.
  // See design/17-logging.md §"register() — Server Startup"
  await loadInstrumentation(loadUserInstrumentation);

  // Initialize cookie signing secrets from config (design/29-cookies.md §"Signed Cookies")
  const cookieSecrets = (runtimeConfig as Record<string, unknown>).cookieSecrets as
    | string[]
    | undefined;
  if (cookieSecrets?.length) {
    const { setCookieSecrets } = await import('#/server/request-context.js');
    setCookieSecrets(cookieSecrets);
  }

  const matchRoute = createRouteMatcher(manifest);
  const matchMetadataRoute = createMetadataRouteMatcher(manifest);

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
      // Patch globalThis.fetch to create OTEL spans for fetch calls.
      // Spans appear as children of the active component span in the dev log tree.
      const { instrumentDevFetch } = await import('../dev-fetch-instrumentation.js');
      instrumentDevFetch();
    }
  }

  const typedBuildManifest = buildManifest as BuildManifest;

  const pipelineConfig: PipelineConfig = {
    proxyLoader: manifest.proxy?.load,
    matchRoute,
    matchMetadataRoute,
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
    // Slow request threshold from timber.config.ts. Default 3000ms, 0 to disable.
    // See design/17-logging.md §"slowRequestMs"
    slowRequestMs: (runtimeConfig as Record<string, unknown>).slowRequestMs as number | undefined,
    enableServerTiming: isDev,
    onPipelineError: isDev
      ? (error: Error, phase: string) => {
          if (_devPipelineErrorHandler) _devPipelineErrorHandler(error, phase);
        }
      : undefined,
    renderFallbackError: (error, req, responseHeaders) =>
      renderFallback(error, req, responseHeaders, isDev, manifest.root, clientBootstrap),
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

  // Parse X-Timber-State-Tree for RSC payload requests (client navigation).
  // The state tree lists sync segments the client has cached — the server
  // skips re-rendering those layouts for a smaller, faster RSC payload.
  // Only used for RSC requests — HTML requests always get a full render.
  // See design/19-client-navigation.md §"X-Timber-State-Tree Header"
  const clientStateTree = isRscPayloadRequest(_req) ? parseClientStateTree(_req) : null;

  // Build the React element tree — loads modules, runs access checks,
  // resolves metadata. DenySignal/RedirectSignal propagate for HTTP handling.
  let routeResult;
  try {
    routeResult = await buildRouteElement(_req, match, interception, clientStateTree);
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

  const { element, headElements, layoutComponents, deferSuspenseFor, skippedSegments } = routeResult;

  // Build head HTML for injection into the SSR output.
  // Collects CSS, fonts, and modulepreload from the build manifest for matched segments.
  // In dev mode the manifest is empty — Vite HMR handles CSS/JS.
  //
  // Link headers (for 103 Early Hints) are emitted by the earlyHints pipeline
  // stage before middleware runs. Here we only emit the <head> HTML fallback tags
  // — these ensure resources load even on platforms without Early Hints support.
  const typedManifest = buildManifest as BuildManifest;
  let headHtml = '';

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

  // Render to RSC Flight stream with signal tracking.
  const { rscStream, signals } = renderRscStream(element, _req);

  // Synchronous redirect — redirect() in access.ts or a non-async component
  // throws during renderToReadableStream creation. Return HTTP redirect.
  if (signals.redirectSignal) {
    return buildRedirectResponse(_req, signals.redirectSignal, responseHeaders);
  }

  // Synchronous deny — deny() in a non-async component throws during
  // renderToReadableStream creation, caught in the try/catch above.
  if (signals.denySignal) {
    if (isRscPayloadRequest(_req)) {
      return renderDenyPageAsRsc(
        signals.denySignal,
        segments,
        layoutComponents as LayoutEntry[],
        responseHeaders,
        createDebugChannelSink
      );
    }
    return renderDenyPage(
      signals.denySignal,
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
  if (signals.renderError && !rscStream) {
    return renderErrorPage(
      signals.renderError.error,
      signals.renderError.status,
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
    return buildRscPayloadResponse(
      _req,
      rscStream!,
      signals,
      segments,
      layoutComponents,
      headElements,
      match,
      responseHeaders,
      skippedSegments
    );
  }

  // Pipe through SSR for HTML rendering with streaming Suspense support.
  return renderSsrResponse({
    req: _req,
    rscStream: rscStream!,
    signals,
    segments,
    layoutComponents,
    match,
    responseHeaders,
    clientBootstrap,
    clientJsDisabled,
    headHtml,
    deferSuspenseFor,
  });
}

// Re-export for generated entry points (e.g., Nitro node-server/bun) to wrap
// the handler with per-request 103 Early Hints sender via ALS.
export { runWithEarlyHintsSender } from '#/server/early-hints-sender.js';

// Re-export for generated entry points to wrap the handler with per-request
// waitUntil support via ALS. See design/11-platform.md §"waitUntil()".
export { runWithWaitUntil } from '#/server/waituntil-bridge.js';

export default await createRequestHandler(routeManifest, config);
