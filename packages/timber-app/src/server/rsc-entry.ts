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

import { createElement } from 'react';
import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc';

import { createPipeline } from './pipeline.js';
import { withSpan, setSpanAttribute, initDevTracing } from './tracing.js';
import type { PipelineConfig, RouteMatch } from './pipeline.js';
import { logRenderError } from './logger.js';
import { resolveLogMode } from './dev-logger.js';
import { createRouteMatcher } from './route-matcher.js';
import type { ManifestSegmentNode } from './route-matcher.js';
import { resolveMetadata, renderMetadataToElements } from './metadata.js';
import type { Metadata } from './types.js';
import { DenySignal, RedirectSignal, RenderError } from './primitives.js';
import { AccessGate } from './access-gate.js';
import { buildClientScripts } from './html-injectors.js';
import type { ClientBootstrapConfig } from './html-injectors.js';
import { renderDenyPage, renderDenyPageAsRsc } from './deny-renderer.js';
import type { LayoutEntry } from './deny-renderer.js';
import {
  collectRouteCss,
  collectRouteFonts,
  collectRouteModulepreloads,
  buildCssLinkTags,
  buildFontPreloadTags,
  buildModulepreloadTags,
} from './build-manifest.js';
import type { BuildManifest } from './build-manifest.js';
import { collectEarlyHintHeaders } from './early-hints.js';
import type { NavContext } from './ssr-entry.js';
import { resolveSlotElement } from './slot-resolver.js';
import { SegmentProvider } from '../client/segment-context.js';
import { TimberErrorBoundary } from '../client/error-boundary.js';
import { handleRouteRequest } from './route-handler.js';
import type { RouteModule } from './route-handler.js';
import type { RouteContext } from './types.js';
import { setParsedSearchParams } from './request-context.js';
import type { SearchParamsDefinition } from '../search-params/create.js';
import { isActionRequest, handleActionRequest } from './action-handler.js';

/**
 * Create a debug channel sink that discards all debug data.
 *
 * React Flight's dev mode serializes server component source code as `$E`
 * entries for DevTools. Without a separate debugChannel, this data is
 * embedded inline in the main RSC stream — leaking source code to the
 * browser. By providing a debug channel, debug data goes to a separate
 * stream that we drain and discard.
 *
 * See design/13-security.md §"Server component source leak"
 *
 * TODO: In the future, expose this debug data to the browser in dev mode
 * for inline error overlays (e.g. component stack traces).
 */
function createDebugChannelSink(): { readable: ReadableStream; writable: WritableStream } {
  const sink = new TransformStream();
  // Drain the readable side so the writable never back-pressures.
  sink.readable.pipeTo(new WritableStream()).catch(() => {});
  return {
    readable: new ReadableStream(), // no commands to send to Flight
    writable: sink.writable,
  };
}

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
  // In noJS mode (output: static + noJS: true), no scripts are injected.
  // In production, uses hashed chunk URLs from the build manifest.
  const clientBootstrap = buildClientScripts({
    ...runtimeConfig,
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
      const headers = collectEarlyHintHeaders(segments, typedBuildManifest);
      for (const h of headers) {
        responseHeaders.append('Link', h);
      }
    },
    render: async (req: Request, match: RouteMatch, responseHeaders: Headers) => {
      return renderRoute(req, match, responseHeaders, clientBootstrap);
    },
    renderNoMatch: async (req: Request, responseHeaders: Headers) => {
      return renderNoMatchPage(req, manifest.root, responseHeaders, clientBootstrap);
    },
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
        revalidateRenderer: async (path: string) => {
          // Re-render the route at `path` to produce an RSC flight payload.
          // This is called when an action calls revalidatePath().
          // Forward original request headers (cookies, session IDs, etc.)
          // but override Accept to request an RSC payload.
          const revalidateHeaders = new Headers(req.headers);
          revalidateHeaders.set('Accept', 'text/x-component');
          const revalidateReq = new Request(new URL(path, req.url), {
            headers: revalidateHeaders,
          });
          const response = await pipeline(revalidateReq);
          if (!response.body) {
            throw new Error(`revalidatePath('${path}') produced no body`);
          }
          return response.body;
        },
      });
      if (actionResponse) return actionResponse;
    }
    return pipeline(req);
  };
}

/** RSC content type for client navigation payload requests. */
const RSC_CONTENT_TYPE = 'text/x-component';

/**
 * Build segment metadata for the X-Timber-Segments response header.
 * Describes the rendered segment chain with async status, enabling
 * the client to populate its segment cache for state tree diffing.
 *
 * Async detection: server components defined as `async function` have
 * constructor.name === 'AsyncFunction'. These layouts always re-render
 * on navigation (they may depend on request context like cookies/params).
 * See design/07-routing.md §"Server Diffing Rules".
 */
function buildSegmentInfo(
  segments: ManifestSegmentNode[],
  layoutComponents: Array<{
    component: (...args: unknown[]) => unknown;
    segment: ManifestSegmentNode;
  }>
): Array<{ path: string; isAsync: boolean }> {
  const layoutBySegment = new Map(
    layoutComponents.map(({ component, segment }) => [segment, component])
  );

  // Deduplicate by path — route groups are transparent and share their
  // parent's urlPath. When a group has its own layout, update the entry
  // to reflect the group's async status (the layout is what matters for
  // segment diffing). Without dedup, the state tree would contain
  // duplicate paths that break the server's skip logic.
  const byPath = new Map<string, { path: string; isAsync: boolean }>();

  for (const segment of segments) {
    const component = layoutBySegment.get(segment);
    const isAsync = component?.constructor?.name === 'AsyncFunction';

    const existing = byPath.get(segment.urlPath);
    if (!existing) {
      byPath.set(segment.urlPath, { path: segment.urlPath, isAsync });
    } else if (component) {
      // Group with a layout overrides the parent entry's async status
      existing.isAsync = isAsync;
    }
  }

  return Array.from(byPath.values());
}

/**
 * Check if a request is asking for an RSC payload (client navigation)
 * rather than full HTML. Client-side navigation sends Accept: text/x-component.
 */
function isRscPayloadRequest(req: Request): boolean {
  const accept = req.headers.get('Accept') ?? '';
  return accept.includes(RSC_CONTENT_TYPE);
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
  clientBootstrap: ClientBootstrapConfig
): Promise<Response> {
  const segments = match.segments as unknown as ManifestSegmentNode[];
  const leaf = segments[segments.length - 1];

  // API routes (route.ts) — run access.ts standalone then dispatch to handler.
  // No React render pass — AccessGate is not used, React.cache is not active.
  // See design/04-authorization.md §"Auth in API Routes".
  if (leaf.route && !leaf.page) {
    return handleApiRoute(_req, match, segments, responseHeaders);
  }

  // Params are passed as a Promise to match Next.js 15+ convention.
  const paramsPromise = Promise.resolve(match.params);

  // Load all modules along the segment chain
  const metadataEntries: Array<{ metadata: Metadata; isPage: boolean }> = [];
  const layoutComponents: Array<{
    component: (...args: unknown[]) => unknown;
    segment: ManifestSegmentNode;
  }> = [];
  let PageComponent: ((...args: unknown[]) => unknown) | null = null;
  let deferSuspenseFor = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLeaf = i === segments.length - 1;

    // Load layout
    if (segment.layout) {
      const mod = (await segment.layout.load()) as Record<string, unknown>;
      if (mod.default) {
        layoutComponents.push({
          component: mod.default as (...args: unknown[]) => unknown,
          segment,
        });
      }
      if (mod.metadata) {
        metadataEntries.push({ metadata: mod.metadata as Metadata, isPage: false });
      }
      // deferSuspenseFor hold window — max across all segments
      if (typeof mod.deferSuspenseFor === 'number' && mod.deferSuspenseFor > deferSuspenseFor) {
        deferSuspenseFor = mod.deferSuspenseFor;
      }
    }

    // Load page (leaf segment only)
    if (isLeaf && segment.page) {
      // Load and apply search-params.ts definition before rendering so
      // searchParams() from @timber/app/server returns parsed typed values.
      if (segment.searchParams) {
        const spMod = (await segment.searchParams.load()) as {
          default?: SearchParamsDefinition<Record<string, unknown>>;
        };
        if (spMod.default) {
          const rawSearchParams = new URL(_req.url).searchParams;
          const parsed = spMod.default.parse(rawSearchParams);
          setParsedSearchParams(parsed);
        }
      }

      const mod = (await segment.page.load()) as Record<string, unknown>;
      if (mod.default) {
        PageComponent = mod.default as (...args: unknown[]) => unknown;
      }
      // Static metadata export
      if (mod.metadata) {
        metadataEntries.push({ metadata: mod.metadata as Metadata, isPage: true });
      }
      // Dynamic generateMetadata function — wrapped in OTEL span
      if (typeof mod.generateMetadata === 'function') {
        type MetadataFn = (props: Record<string, unknown>) => Promise<Metadata>;
        const generated = await withSpan(
          'timber.metadata',
          { 'timber.segment': segment.segmentName ?? segment.urlPath },
          () => (mod.generateMetadata as MetadataFn)({ params: paramsPromise })
        );
        if (generated) {
          metadataEntries.push({ metadata: generated, isPage: true });
        }
      }
      // deferSuspenseFor hold window — max across all segments
      if (typeof mod.deferSuspenseFor === 'number' && mod.deferSuspenseFor > deferSuspenseFor) {
        deferSuspenseFor = mod.deferSuspenseFor;
      }
    }
  }

  if (!PageComponent) {
    return new Response(null, { status: 404 });
  }

  // Run access.ts checks before rendering — top-down through the segment chain.
  // This catches deny()/redirect() signals before the RSC stream is created,
  // producing correct HTTP status codes for both full page loads and RSC
  // payload requests (client navigation). The AccessGate components in the
  // tree will re-run these checks during rendering (React.cache dedup means
  // no double-execution for cached auth functions).
  // See design/04-authorization.md §"access.ts Runs on Every Navigation".
  for (const segment of segments) {
    if (segment.access) {
      const accessMod = (await segment.access.load()) as Record<string, unknown>;
      const accessFn = accessMod.default as
        | ((ctx: { params: Record<string, string | string[]>; searchParams: unknown }) => unknown)
        | undefined;
      if (accessFn) {
        try {
          await withSpan(
            'timber.access',
            { 'timber.segment': segment.segmentName ?? 'unknown' },
            async () => {
              try {
                await accessFn({ params: match.params, searchParams: {} });
                await setSpanAttribute('timber.result', 'pass');
              } catch (error) {
                if (error instanceof DenySignal) {
                  await setSpanAttribute('timber.result', 'deny');
                  await setSpanAttribute('timber.deny_status', error.status);
                  if (error.sourceFile) {
                    await setSpanAttribute('timber.deny_file', error.sourceFile);
                  }
                } else if (error instanceof RedirectSignal) {
                  await setSpanAttribute('timber.result', 'redirect');
                }
                throw error;
              }
            }
          );
        } catch (error) {
          if (error instanceof DenySignal) {
            if (isRscPayloadRequest(_req)) {
              return renderDenyPageAsRsc(
                error,
                segments,
                layoutComponents as LayoutEntry[],
                responseHeaders,
                createDebugChannelSink
              );
            }
            return renderDenyPage(
              error,
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
          if (error instanceof RedirectSignal) {
            responseHeaders.set('Location', error.location);
            return new Response(null, {
              status: error.status,
              headers: responseHeaders,
            });
          }
          throw error;
        }
      }
    }
  }

  // Resolve metadata
  const resolvedMetadata = resolveMetadata(metadataEntries);
  const headElements = renderMetadataToElements(resolvedMetadata);

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

  const preloadUrls = collectRouteModulepreloads(segments, typedManifest);
  if (preloadUrls.length > 0) {
    headHtml += buildModulepreloadTags(preloadUrls);
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

  // Build element tree: page wrapped in layouts (innermost to outermost)
  // Route components have custom props (params, children) that don't fit
  // React's built-in element type overloads — use the untyped form.
  const h = createElement as (...args: unknown[]) => React.ReactElement;

  // Wrap the page component in an OTEL span. The wrapper is an async server
  // component that React calls during rendering — the span captures the full
  // page render duration including any async data fetching.
  const TracedPage = async (props: Record<string, unknown>) => {
    return withSpan(
      'timber.page',
      { 'timber.route': match.segments[match.segments.length - 1]?.urlPath ?? '/' },
      () => (PageComponent as (props: Record<string, unknown>) => unknown)(props)
    );
  };

  let element = h(TracedPage, {
    params: paramsPromise,
    searchParams: {},
  });

  // Build a lookup of layout components by segment for O(1) access.
  const layoutBySegment = new Map(
    layoutComponents.map(({ component, segment }) => [segment, component])
  );

  // Wrap from innermost (leaf) to outermost (root), processing every
  // segment in the chain. Each segment may contribute:
  //   1. Error boundaries (status files + error.tsx) — wrap children
  //      INSIDE the layout so error fallbacks preserve the layout shell
  //   2. Layout component — wraps children + parallel slots
  //   3. SegmentProvider — records position for useSelectedLayoutSegment
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];

    // Wrap with error boundaries from this segment (inside layout).
    // No key prop — error boundaries reset via componentDidUpdate when
    // children change on client navigation. A route-based key would force
    // React to unmount/remount the boundary (and its subtree) on every
    // navigation, which breaks layout state preservation.
    element = await wrapSegmentWithErrorBoundaries(segment, element, h);

    // Wrap in AccessGate if segment has access.ts.
    // AccessGate calls the segment's access function before rendering children.
    // If access.ts calls deny() or redirect(), the signal propagates as a
    // render-phase throw — caught by the flush controller to produce the
    // correct HTTP status code. See design/04-authorization.md.
    if (segment.access) {
      const accessMod = (await segment.access.load()) as Record<string, unknown>;
      const accessFn = accessMod.default as
        | ((ctx: { params: Record<string, string | string[]>; searchParams: unknown }) => unknown)
        | undefined;
      if (accessFn) {
        element = h(AccessGate, {
          accessFn,
          params: match.params,
          searchParams: {},
          segmentName: segment.segmentName,
          children: element,
        });
      }
    }

    // Wrap with layout if this segment has one — traced with OTEL span
    const layoutComponent = layoutBySegment.get(segment);
    if (layoutComponent) {
      // Resolve parallel slots for this layout
      const slotProps: Record<string, unknown> = {};
      const slotEntries = Object.entries(segment.slots ?? {});
      for (const [slotName, slotNode] of slotEntries) {
        slotProps[slotName] = await resolveSlotElement(
          slotNode as ManifestSegmentNode,
          match,
          paramsPromise,
          h
        );
      }

      const segmentPath = segment.urlPath.split('/');
      const parallelRouteKeys = Object.keys(segment.slots ?? {});

      // Wrap the layout component in an OTEL span. The wrapper is an async
      // server component — the span captures the full layout render duration.
      const segmentForSpan = segment;
      const layoutComponentForSpan = layoutComponent;
      const TracedLayout = async (props: Record<string, unknown>) => {
        return withSpan('timber.layout', { 'timber.segment': segmentForSpan.urlPath }, () =>
          (layoutComponentForSpan as (props: Record<string, unknown>) => unknown)(props)
        );
      };

      element = h(SegmentProvider, {
        segments: segmentPath,
        parallelRouteKeys,
        children: h(TracedLayout, {
          ...slotProps,
          params: paramsPromise,
          searchParams: {},
          children: element,
        }),
      });
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
  let rscStream: ReadableStream<Uint8Array>;
  try {
    rscStream = renderToReadableStream(
      element,
      {
        onError(error: unknown) {
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
      throw error;
    }
  }

  // Synchronous redirect — redirect() in access.ts or a non-async component
  // throws during renderToReadableStream creation. Return HTTP redirect.
  if (redirectSignal) {
    responseHeaders.set('Location', redirectSignal.location);
    return new Response(null, {
      status: redirectSignal.status,
      headers: responseHeaders,
    });
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
  const segmentInfo = buildSegmentInfo(segments, layoutComponents);
  const segmentScript = `<script>self.__timber_segments=${JSON.stringify(segmentInfo)}</script>`;

  const navContext: NavContext = {
    pathname: new URL(_req.url).pathname,
    params: match.params,
    searchParams: Object.fromEntries(new URL(_req.url).searchParams),
    statusCode: 200,
    responseHeaders,
    headHtml: headHtml + clientBootstrap.preloadLinks + segmentScript,
    bootstrapScriptContent: clientBootstrap.bootstrapScriptContent,
    rscStream: inlineStream,
    deferSuspenseFor: deferSuspenseFor > 0 ? deferSuspenseFor : undefined,
  };

  try {
    return await callSsr(ssrStream, navContext);
  } catch (ssrError) {
    // SSR shell rendering failed — the error was outside Suspense
    // (inside Suspense errors stream after shell succeeds).

    // RedirectSignal outside Suspense → HTTP redirect
    // Note: redirectSignal is assigned inside onError callback — TS narrowing
    // doesn't track mutations in callbacks, so we cast.
    const trackedRedirect = redirectSignal as RedirectSignal | null;
    if (trackedRedirect) {
      responseHeaders.set('Location', trackedRedirect.location);
      return new Response(null, {
        status: trackedRedirect.status,
        headers: responseHeaders,
      });
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

/**
 * Wrap an element with error boundaries from a segment's status files and error.tsx.
 *
 * Follows the same fallback chain as tree-builder.ts:
 *   1. Specific status files (403.tsx, 503.tsx) — innermost, highest priority
 *   2. Category catch-alls (4xx.tsx, 5xx.tsx)
 *   3. error.tsx — outermost, catches anything unmatched
 *
 * These boundaries are essential for client-side navigation: when the client
 * decodes the RSC stream, errors (deny/throw) must be caught by a boundary
 * to render the error page UI. For initial HTML render, if a deny() fires
 * outside Suspense, the pipeline detects denySignal and re-renders with
 * renderDenyPage for the correct status code — the boundary is harmless.
 */
async function wrapSegmentWithErrorBoundaries(
  segment: ManifestSegmentNode,
  element: React.ReactElement,
  h: (...args: unknown[]) => React.ReactElement
): Promise<React.ReactElement> {
  // Specific status files (innermost — highest priority at runtime)
  if (segment.statusFiles) {
    for (const [key, file] of Object.entries(segment.statusFiles)) {
      if (key !== '4xx' && key !== '5xx') {
        const status = parseInt(key, 10);
        if (!isNaN(status)) {
          const mod = (await file.load()) as Record<string, unknown>;
          if (mod.default) {
            element = h(TimberErrorBoundary, {
              fallbackComponent: mod.default,
              status,
              children: element,
            });
          }
        }
      }
    }

    // Category catch-alls (4xx.tsx, 5xx.tsx)
    for (const [key, file] of Object.entries(segment.statusFiles)) {
      if (key === '4xx' || key === '5xx') {
        const mod = (await file.load()) as Record<string, unknown>;
        if (mod.default) {
          element = h(TimberErrorBoundary, {
            fallbackComponent: mod.default,
            status: key === '4xx' ? 400 : 500,
            children: element,
          });
        }
      }
    }
  }

  // error.tsx (outermost — catches anything not matched by status files)
  if (segment.error) {
    const mod = (await segment.error.load()) as Record<string, unknown>;
    if (mod.default) {
      element = h(TimberErrorBoundary, {
        fallbackComponent: mod.default,
        children: element,
      });
    }
  }

  return element;
}

/**
 * Handle an API route (route.ts) request.
 *
 * Runs access.ts standalone for all segments in the chain (no React render
 * pass, no AccessGate component). Then dispatches to the route handler.
 * See design/04-authorization.md §"Auth in API Routes".
 */
async function handleApiRoute(
  req: Request,
  match: RouteMatch,
  segments: ManifestSegmentNode[],
  responseHeaders: Headers
): Promise<Response> {
  const leaf = segments[segments.length - 1];

  // Run access.ts for every segment in the chain, top-down.
  // Each access.ts is independent — deny()/redirect() throws a signal.
  for (const segment of segments) {
    if (segment.access) {
      const accessMod = (await segment.access.load()) as Record<string, unknown>;
      const accessFn = accessMod.default as
        | ((ctx: { params: Record<string, string | string[]>; searchParams: unknown }) => unknown)
        | undefined;
      if (accessFn) {
        try {
          await withSpan(
            'timber.access',
            { 'timber.segment': segment.segmentName ?? 'unknown' },
            async () => {
              try {
                await accessFn({ params: match.params, searchParams: {} });
                await setSpanAttribute('timber.result', 'pass');
              } catch (error) {
                if (error instanceof DenySignal) {
                  await setSpanAttribute('timber.result', 'deny');
                  await setSpanAttribute('timber.deny_status', error.status);
                  if (error.sourceFile) {
                    await setSpanAttribute('timber.deny_file', error.sourceFile);
                  }
                } else if (error instanceof RedirectSignal) {
                  await setSpanAttribute('timber.result', 'redirect');
                }
                throw error;
              }
            }
          );
        } catch (error) {
          if (error instanceof DenySignal) {
            return renderApiDeny(error, segments, responseHeaders);
          }
          if (error instanceof RedirectSignal) {
            responseHeaders.set('Location', error.location);
            return new Response(null, { status: error.status, headers: responseHeaders });
          }
          throw error;
        }
      }
    }
  }

  // Load route.ts module and dispatch
  const routeMod = (await leaf.route!.load()) as RouteModule;
  const ctx: RouteContext = {
    req,
    params: match.params,
    searchParams: new URL(req.url).searchParams,
    headers: responseHeaders,
  };
  return handleRouteRequest(routeMod, ctx);
}

/**
 * Render a deny response for an API route (route.ts).
 *
 * Tries JSON status file chain first. Falls back to bare JSON response.
 * Never renders a component — API consumers get structured JSON, not HTML.
 * See design/10-error-handling.md §"Format Selection for deny()"
 */
async function renderApiDeny(
  deny: DenySignal,
  segments: ManifestSegmentNode[],
  responseHeaders: Headers
): Promise<Response> {
  const { resolveManifestStatusFile } = await import('./manifest-status-resolver.js');

  const resolution = resolveManifestStatusFile(deny.status, segments, 'json');
  if (resolution) {
    const mod = (await resolution.file.load()) as Record<string, unknown>;
    const jsonContent = mod.default ?? mod;
    responseHeaders.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(jsonContent), {
      status: deny.status,
      headers: responseHeaders,
    });
  }

  // No JSON status file — bare JSON fallback
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ error: true, status: deny.status }), {
    status: deny.status,
    headers: responseHeaders,
  });
}

/**
 * Load the SSR entry and pass the RSC stream for HTML rendering.
 */
async function callSsr(
  rscStream: ReadableStream<Uint8Array>,
  navContext: NavContext
): Promise<Response> {
  const ssrEntry = await import.meta.viteRsc.import<typeof import('./ssr-entry.js')>(
    './ssr-entry.js',
    { environment: 'ssr' }
  );
  return ssrEntry.handleSsr(rscStream, navContext);
}

/**
 * Render a 404 page for URLs that don't match any route.
 *
 * Uses the root segment's 404.tsx (or 4xx.tsx / error.tsx fallback)
 * wrapped in the root layout, via the same renderDenyPage path
 * used for in-route deny() calls.
 */
async function renderNoMatchPage(
  req: Request,
  rootSegment: ManifestSegmentNode,
  responseHeaders: Headers,
  clientBootstrap: ClientBootstrapConfig
): Promise<Response> {
  const segments = [rootSegment];

  // Load root layout if present
  const layoutComponents: LayoutEntry[] = [];
  if (rootSegment.layout) {
    const mod = (await rootSegment.layout.load()) as Record<string, unknown>;
    if (mod.default) {
      layoutComponents.push({
        component: mod.default as (...args: unknown[]) => unknown,
        segment: rootSegment,
      });
    }
  }

  const deny = new DenySignal(404);
  const match: RouteMatch = { segments: segments as never, params: {} };

  return renderDenyPage(
    deny,
    segments,
    layoutComponents,
    req,
    match,
    responseHeaders,
    clientBootstrap,
    createDebugChannelSink,
    callSsr
  );
}

/**
 * Render an error page for unhandled throws or RenderError outside Suspense.
 *
 * Walks the segment chain from leaf to root looking for:
 *   1. Specific status file (e.g. 503.tsx) matching the error's status
 *   2. 5xx.tsx category catch-all
 *   3. error.tsx
 *
 * Renders the found component with { error, digest, reset } props
 * wrapped in layouts, with the correct HTTP status code.
 */
async function renderErrorPage(
  error: unknown,
  status: number,
  segments: ManifestSegmentNode[],
  layoutComponents: LayoutEntry[],
  req: Request,
  match: RouteMatch,
  responseHeaders: Headers,
  clientBootstrap: ClientBootstrapConfig
): Promise<Response> {
  const h = createElement as (...args: unknown[]) => React.ReactElement;

  // Walk segments from leaf to root to find the error component
  let errorComponent: ((...args: unknown[]) => unknown) | null = null;
  let foundSegmentIndex = -1;

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];

    // Check specific status file (e.g. 503.tsx)
    if (segment.statusFiles) {
      const statusKey = String(status);
      const specificFile = segment.statusFiles[statusKey];
      if (specificFile) {
        const mod = (await specificFile.load()) as Record<string, unknown>;
        if (mod.default) {
          errorComponent = mod.default as (...args: unknown[]) => unknown;
          foundSegmentIndex = i;
          break;
        }
      }

      // Check 5xx.tsx category catch-all
      const categoryFile = segment.statusFiles['5xx'];
      if (categoryFile && status >= 500 && status <= 599) {
        const mod = (await categoryFile.load()) as Record<string, unknown>;
        if (mod.default) {
          errorComponent = mod.default as (...args: unknown[]) => unknown;
          foundSegmentIndex = i;
          break;
        }
      }
    }

    // Check error.tsx
    if (segment.error) {
      const mod = (await segment.error.load()) as Record<string, unknown>;
      if (mod.default) {
        errorComponent = mod.default as (...args: unknown[]) => unknown;
        foundSegmentIndex = i;
        break;
      }
    }
  }

  // No error component found — fall back to bare response
  if (!errorComponent) {
    return new Response(null, { status, headers: responseHeaders });
  }

  // Build digest prop for RenderError, null for unhandled errors
  const digest =
    error instanceof RenderError ? { code: error.code, data: error.digest.data } : null;

  // Error pages receive { error, digest, reset } per design/10-error-handling.md
  let element = h(errorComponent, {
    error: error instanceof Error ? error : new Error(String(error)),
    digest,
    reset: undefined, // reset is only meaningful on the client
  });

  // Wrap in layouts from root up to the segment where the error file was found
  const resolvedSegments = new Set(segments.slice(0, foundSegmentIndex + 1));
  const layoutsToWrap = layoutComponents.filter((lc) => resolvedSegments.has(lc.segment));
  for (let i = layoutsToWrap.length - 1; i >= 0; i--) {
    const { component } = layoutsToWrap[i];
    element = h(component, null, element);
  }

  // Render to fresh RSC Flight stream
  const rscStream = renderToReadableStream(element, {
    onError(err: unknown) {
      logRenderError({ method: req.method, path: new URL(req.url).pathname, error: err });
    },
    debugChannel: createDebugChannelSink(),
  });

  const [ssrStream, inlineStream] = rscStream.tee();

  const navContext: NavContext = {
    pathname: new URL(req.url).pathname,
    params: match.params,
    searchParams: Object.fromEntries(new URL(req.url).searchParams),
    statusCode: status,
    responseHeaders,
    headHtml: '',
    bootstrapScriptContent: clientBootstrap.bootstrapScriptContent,
    rscStream: inlineStream,
  };

  return callSsr(ssrStream, navContext);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default await createRequestHandler(routeManifest, config);
