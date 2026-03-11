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
import type { PipelineConfig, RouteMatch } from './pipeline.js';
import { logRenderError } from './logger.js';
import { createRequestCollector, resolveLogMode } from './dev-logger.js';
import type { DevLogEmitter } from './dev-log-events.js';
import { createRouteMatcher } from './route-matcher.js';
import type { ManifestSegmentNode } from './route-matcher.js';
import { resolveMetadata, renderMetadataToElements } from './metadata.js';
import type { Metadata } from './types.js';
import { DenySignal } from './primitives.js';
import { buildClientScripts } from './html-injectors.js';
import { resolveManifestStatusFile } from './manifest-status-resolver.js';
import {
  collectRouteCss,
  collectRouteFonts,
  collectRouteModulepreloads,
  buildCssLinkTags,
  buildFontPreloadTags,
  buildFontLinkHeaders,
  buildLinkHeaders,
  buildModulepreloadTags,
} from './build-manifest.js';
import type { BuildManifest } from './build-manifest.js';

import type { NavContext } from './ssr-entry.js';
import { resolveSlotElement } from './slot-resolver.js';
import { SegmentProvider } from '../client/segment-context.js';

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

/**
 * Create the RSC request handler from the route manifest.
 *
 * The pipeline handles: proxy.ts → canonicalize → route match →
 * 103 Early Hints → middleware.ts → render (RSC → SSR → HTML).
 */
function createRequestHandler(manifest: typeof routeManifest, runtimeConfig: typeof config) {
  const matchRoute = createRouteMatcher(manifest);

  // Build the client bootstrap script tags.
  // In noJS mode (output: static + noJS: true), no scripts are injected.
  // In production, uses hashed chunk URLs from the build manifest.
  const scriptsHtml = buildClientScripts({
    ...runtimeConfig,
    buildManifest: buildManifest as BuildManifest,
  });

  // Dev logging — resolve log mode once at handler creation time.
  // In production, isDev is false and no dev log callback is installed,
  // so the pipeline creates no emitters and has zero overhead.
  const isDev = process.env.NODE_ENV !== 'production';
  const devLogMode = isDev ? resolveLogMode() : 'quiet';
  const slowPhaseMs = (runtimeConfig as Record<string, unknown>).slowPhaseMs as number | undefined;

  const pipelineConfig: PipelineConfig = {
    proxy: manifest.proxy?.load,
    matchRoute,
    render: async (req: Request, match: RouteMatch, responseHeaders: Headers) => {
      return renderRoute(req, match, responseHeaders, scriptsHtml);
    },
    onDevLog: isDev && devLogMode !== 'quiet'
      ? (emitter: DevLogEmitter) => {
          const collector = createRequestCollector({ mode: devLogMode, slowPhaseMs });
          emitter.on(collector.collect);
          // Subscribe to request-end to flush formatted output to stderr.
          emitter.on((event) => {
            if (event.type === 'request-end') {
              const output = collector.format(devLogMode);
              if (output) {
                process.stderr.write(output);
              }
            }
          });
        }
      : undefined,
  };

  const pipeline = createPipeline(pipelineConfig);
  return pipeline;
}

/** RSC content type for client navigation payload requests. */
const RSC_CONTENT_TYPE = 'text/x-component';

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
  scriptsHtml: string
): Promise<Response> {
  const segments = match.segments as unknown as ManifestSegmentNode[];

  // Params are passed as a Promise to match Next.js 15+ convention.
  const paramsPromise = Promise.resolve(match.params);

  // Load all modules along the segment chain
  const metadataEntries: Array<{ metadata: Metadata; isPage: boolean }> = [];
  const layoutComponents: Array<{
    component: (...args: unknown[]) => unknown;
    segment: ManifestSegmentNode;
  }> = [];
  let PageComponent: ((...args: unknown[]) => unknown) | null = null;

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
    }

    // Load page (leaf segment only)
    if (isLeaf && segment.page) {
      const mod = (await segment.page.load()) as Record<string, unknown>;
      if (mod.default) {
        PageComponent = mod.default as (...args: unknown[]) => unknown;
      }
      // Static metadata export
      if (mod.metadata) {
        metadataEntries.push({ metadata: mod.metadata as Metadata, isPage: true });
      }
      // Dynamic generateMetadata function
      if (typeof mod.generateMetadata === 'function') {
        type MetadataFn = (props: Record<string, unknown>) => Promise<Metadata>;
        const generated = await (mod.generateMetadata as MetadataFn)({
          params: paramsPromise,
        });
        if (generated) {
          metadataEntries.push({ metadata: generated, isPage: true });
        }
      }
    }
  }

  if (!PageComponent) {
    return new Response(null, { status: 404 });
  }

  // Resolve metadata
  const resolvedMetadata = resolveMetadata(metadataEntries);
  const headElements = renderMetadataToElements(resolvedMetadata);

  // Build head HTML for injection into the SSR output
  let headHtml = '';

  // Collect CSS from the build manifest for matched segments.
  // In dev mode buildManifest.css is empty — Vite HMR handles CSS.
  const typedManifest = buildManifest as BuildManifest;
  const cssUrls = collectRouteCss(segments, typedManifest);
  if (cssUrls.length > 0) {
    headHtml += buildCssLinkTags(cssUrls);
    // Add Link preload headers — Cloudflare CDN converts these to 103 Early Hints.
    const linkHeader = buildLinkHeaders(cssUrls);
    responseHeaders.append('Link', linkHeader);
  }

  // Collect font preloads from the build manifest for matched segments.
  // Font Link headers enable 103 Early Hints; <link rel="preload"> in <head>
  // is the fallback for platforms without Early Hints support.
  const fontEntries = collectRouteFonts(segments, typedManifest);
  if (fontEntries.length > 0) {
    headHtml += buildFontPreloadTags(fontEntries);
    responseHeaders.append('Link', buildFontLinkHeaders(fontEntries));
  }

  // Collect modulepreload hints for route-specific JS chunks.
  // In dev mode modulepreload is empty — Vite HMR handles module loading.
  const preloadUrls = collectRouteModulepreloads(segments, typedManifest);
  if (preloadUrls.length > 0) {
    headHtml += buildModulepreloadTags(preloadUrls);
  }

  for (const el of headElements) {
    if (el.tag === 'title' && el.content) {
      headHtml += `<title>${escapeHtml(el.content)}</title>`;
    } else if (el.attrs) {
      const attrs = Object.entries(el.attrs)
        .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
        .join(' ');
      headHtml += `<${el.tag} ${attrs}>`;
    }
  }

  // Build element tree: page wrapped in layouts (innermost to outermost)
  // Route components have custom props (params, children) that don't fit
  // React's built-in element type overloads — use the untyped form.
  const h = createElement as (...args: unknown[]) => React.ReactElement;

  let element = h(PageComponent, {
    params: paramsPromise,
    searchParams: {},
  });

  // Wrap in layouts from innermost to outermost.
  // For each layout, resolve parallel slots and pass them as named props.
  // Each layout is also wrapped with a SegmentProvider that records
  // its position in the segment tree for useSelectedLayoutSegment hooks.
  for (let i = layoutComponents.length - 1; i >= 0; i--) {
    const { component, segment } = layoutComponents[i];

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

    // Compute URL segments from root to this layout for the SegmentProvider.
    // urlPath is the cumulative path (e.g. "/dashboard/settings"), split into
    // segments so the hook knows this layout's depth in the tree.
    const segmentPath = segment.urlPath.split('/');
    const parallelRouteKeys = Object.keys(segment.slots ?? {});

    element = h(SegmentProvider, {
      segments: segmentPath,
      parallelRouteKeys,
      children: h(component, { ...slotProps, children: element }),
    });
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
  let denySignal: DenySignal | null = null;
  let rscStream: ReadableStream<Uint8Array>;
  try {
    rscStream = renderToReadableStream(
      element,
      {
        onError(error: unknown) {
          if (error instanceof DenySignal) {
            denySignal = error;
            return;
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
    } else {
      throw error;
    }
  }

  // For async server components, deny() throws during stream consumption
  // (not stream creation). Read the RSC stream fully to trigger onError,
  // then check denySignal. If deny was called, discard the buffered stream
  // and render the error page. Otherwise, replay the buffer as a stream.
  //
  // This is safe for performance because the RSC stream encodes the full
  // component tree — SSR must consume it entirely anyway.
  if (!denySignal && rscStream!) {
    rscStream = await bufferRscStream(rscStream, () => denySignal);
  }

  // If deny() was called during rendering, render the status-code error page
  // (e.g. 404.tsx, 403.tsx) as a fresh RSC stream. All DenySignal handling
  // stays in the RSC entry — SSR never needs to detect or parse deny errors.
  if (denySignal) {
    // For RSC payload requests, still render the deny page as RSC stream
    // so the client can reconcile the error page into the existing DOM.
    if (isRscPayloadRequest(_req)) {
      return renderDenyPageAsRsc(denySignal, segments, layoutComponents, responseHeaders);
    }
    return renderDenyPage(
      denySignal,
      segments,
      layoutComponents,
      _req,
      match,
      responseHeaders,
      scriptsHtml
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
    return new Response(rscStream!, {
      status: 200,
      headers: responseHeaders,
    });
  }

  // Tee the RSC stream — one copy goes to SSR for HTML rendering,
  // the other is inlined in the HTML for client-side hydration.
  // The client reads __TIMBER_RSC_PAYLOAD via createFromReadableStream
  // to hydrate the React tree without a second server round-trip.
  const [ssrStream, inlineStream] = rscStream!.tee();

  // Pass the RSC stream to the SSR entry for HTML rendering.
  // The SSR entry runs in a separate Vite environment (separate module graph)
  // and decodes client references using its own module map.
  const navContext: NavContext = {
    pathname: new URL(_req.url).pathname,
    params: match.params,
    searchParams: Object.fromEntries(new URL(_req.url).searchParams),
    statusCode: 200,
    responseHeaders,
    headHtml,
    scriptsHtml,
    rscStream: inlineStream,
  };

  return callSsr(ssrStream, navContext);
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
 * Render a status-code error page for a DenySignal.
 *
 * Resolves the appropriate status-code file (e.g. 404.tsx, 403.tsx) from the
 * segment chain, renders it through a fresh RSC→SSR pipeline, and returns
 * an HTML Response with the correct status code.
 *
 * Falls back to a bare Response(null, { status }) when no status-code page
 * exists in the segment chain.
 */
async function renderDenyPage(
  deny: DenySignal,
  segments: ManifestSegmentNode[],
  layoutComponents: Array<{
    component: (...args: unknown[]) => unknown;
    segment: ManifestSegmentNode;
  }>,
  req: Request,
  match: RouteMatch,
  responseHeaders: Headers,
  scriptsHtml: string
): Promise<Response> {
  const resolution = resolveManifestStatusFile(deny.status, segments);

  // No status-code page found — fall back to bare response
  if (!resolution) {
    return new Response(null, { status: deny.status, headers: responseHeaders });
  }

  // Load the status-code page component
  const mod = (await resolution.file.load()) as Record<string, unknown>;
  if (!mod.default) {
    return new Response(null, { status: deny.status, headers: responseHeaders });
  }

  const ErrorPageComponent = mod.default as (...args: unknown[]) => unknown;
  const h = createElement as (...args: unknown[]) => React.ReactElement;

  // 4xx status-code pages receive { status, dangerouslyPassData }
  // per design/10-error-handling.md §"Status-Code File Props"
  let element = h(ErrorPageComponent, {
    status: deny.status,
    dangerouslyPassData: deny.data,
  });

  // Wrap in layouts from root up to the segment where the status file was found.
  // Compare by segment index in the original segments array, not layoutComponents index
  // (not every segment has a layout, so indices don't align).
  const resolvedSegments = new Set(segments.slice(0, resolution.segmentIndex + 1));
  const layoutsToWrap = layoutComponents.filter((lc) => resolvedSegments.has(lc.segment));
  for (let i = layoutsToWrap.length - 1; i >= 0; i--) {
    const { component } = layoutsToWrap[i];
    element = h(component, null, element);
  }

  // Build head HTML from error page metadata (if any)
  let headHtml = '';
  if (mod.metadata) {
    const resolvedMeta = resolveMetadata([{ metadata: mod.metadata as Metadata, isPage: true }]);
    const headElements = renderMetadataToElements(resolvedMeta);
    for (const el of headElements) {
      if (el.tag === 'title' && el.content) {
        headHtml += `<title>${escapeHtml(el.content)}</title>`;
      } else if (el.attrs) {
        const attrs = Object.entries(el.attrs)
          .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
          .join(' ');
        headHtml += `<${el.tag} ${attrs}>`;
      }
    }
  }

  // Render the error page to a fresh RSC Flight stream.
  // The error page component should not call deny() — if it does,
  // the error is logged and the stream may be incomplete.
  const rscStream = renderToReadableStream(element, {
    onError(error: unknown) {
      logRenderError({ method: req.method, path: new URL(req.url).pathname, error });
    },
    debugChannel: createDebugChannelSink(),
  });

  const [ssrStream, inlineStream] = rscStream.tee();

  const navContext: NavContext = {
    pathname: new URL(req.url).pathname,
    params: match.params,
    searchParams: Object.fromEntries(new URL(req.url).searchParams),
    statusCode: deny.status,
    responseHeaders,
    headHtml,
    scriptsHtml,
    rscStream: inlineStream,
  };

  return callSsr(ssrStream, navContext);
}

/**
 * Render a status-code error page as a raw RSC Flight stream for client navigation.
 *
 * Same as renderDenyPage but skips SSR — returns the RSC stream directly
 * so the client can reconcile the error page into the existing DOM.
 */
async function renderDenyPageAsRsc(
  deny: DenySignal,
  segments: ManifestSegmentNode[],
  layoutComponents: Array<{
    component: (...args: unknown[]) => unknown;
    segment: ManifestSegmentNode;
  }>,
  responseHeaders: Headers
): Promise<Response> {
  const resolution = resolveManifestStatusFile(deny.status, segments);

  if (!resolution) {
    responseHeaders.set('content-type', `${RSC_CONTENT_TYPE}; charset=utf-8`);
    return new Response(null, { status: deny.status, headers: responseHeaders });
  }

  const mod = (await resolution.file.load()) as Record<string, unknown>;
  if (!mod.default) {
    responseHeaders.set('content-type', `${RSC_CONTENT_TYPE}; charset=utf-8`);
    return new Response(null, { status: deny.status, headers: responseHeaders });
  }

  const ErrorPageComponent = mod.default as (...args: unknown[]) => unknown;
  const h = createElement as (...args: unknown[]) => React.ReactElement;

  let element = h(ErrorPageComponent, {
    status: deny.status,
    dangerouslyPassData: deny.data,
  });

  // Wrap in layouts up to the segment where the status file was found
  const resolvedSegments = new Set(segments.slice(0, resolution.segmentIndex + 1));
  const layoutsToWrap = layoutComponents.filter((lc) => resolvedSegments.has(lc.segment));
  for (let i = layoutsToWrap.length - 1; i >= 0; i--) {
    const { component } = layoutsToWrap[i];
    element = h(component, null, element);
  }

  const rscStream = renderToReadableStream(element, {
    onError(error: unknown) {
      console.error('[timber] Error page RSC render error:', error);
    },
    debugChannel: createDebugChannelSink(),
  });

  responseHeaders.set('content-type', `${RSC_CONTENT_TYPE}; charset=utf-8`);
  responseHeaders.set('Vary', 'Accept');
  return new Response(rscStream, {
    status: deny.status,
    headers: responseHeaders,
  });
}

/**
 * Buffer the RSC stream to detect deny() in async server components.
 *
 * For async components, deny() throws during stream consumption — the
 * onError callback fires only when React resolves the component. By
 * reading the full stream we give React a chance to report errors.
 *
 * Returns a new ReadableStream that replays the buffered chunks.
 * If getDeny() returns a signal, the caller discards this stream.
 */
async function bufferRscStream(
  stream: ReadableStream<Uint8Array>,
  getDeny: () => DenySignal | null
): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    // Stop early if deny was detected — no need to read more
    if (getDeny()) break;
  }

  // Replay buffered chunks as a new ReadableStream
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default createRequestHandler(routeManifest, config);
