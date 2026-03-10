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

import { createElement } from 'react';
import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc';

import { createPipeline } from './pipeline.js';
import type { PipelineConfig, RouteMatch } from './pipeline.js';
import { createRouteMatcher } from './route-matcher.js';
import type { ManifestSegmentNode } from './route-matcher.js';
import { resolveMetadata, renderMetadataToElements } from './metadata.js';
import type { Metadata } from './types.js';
import { DenySignal } from './primitives.js';
import { buildClientScripts } from './html-injectors.js';

import type { NavContext } from './ssr-entry.js';

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
  const scriptsHtml = buildClientScripts(runtimeConfig);

  const pipelineConfig: PipelineConfig = {
    proxy: manifest.proxy?.load,
    matchRoute,
    render: async (req: Request, match: RouteMatch, responseHeaders: Headers) => {
      return renderRoute(req, match, responseHeaders, scriptsHtml);
    },
  };

  const pipeline = createPipeline(pipelineConfig);
  return pipeline;
}

/**
 * Render a matched route to an HTML Response via RSC → SSR pipeline.
 *
 * 1. Load page/layout components from the segment chain
 * 2. Resolve metadata
 * 3. Render to RSC Flight stream (serializes "use client" as references)
 * 4. Pass RSC stream to SSR entry for HTML rendering
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

  // Wrap in layouts from innermost to outermost
  for (let i = layoutComponents.length - 1; i >= 0; i--) {
    const { component } = layoutComponents[i];
    element = h(component, null, element);
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
  let renderStatus = 200;
  let rscStream: ReadableStream<Uint8Array>;
  try {
    rscStream = renderToReadableStream(
      element,
      {
        onError(error: unknown) {
          if (error instanceof DenySignal) {
            renderStatus = error.status;
            return;
          }
          console.error('[timber] RSC render error:', error);
        },
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
      return new Response(null, { status: error.status });
    }
    throw error;
  }

  // Pass the RSC stream to the SSR entry for HTML rendering.
  // The SSR entry runs in a separate Vite environment (separate module graph)
  // and decodes client references using its own module map.
  const navContext: NavContext = {
    pathname: new URL(_req.url).pathname,
    params: match.params,
    searchParams: Object.fromEntries(new URL(_req.url).searchParams),
    statusCode: renderStatus,
    responseHeaders,
    headHtml,
    scriptsHtml,
  };

  // Load the SSR entry from the SSR environment.
  // import.meta.viteRsc.import crosses the RSC→SSR environment boundary.
  const ssrEntry = await import.meta.viteRsc.import<typeof import('./ssr-entry.js')>(
    './ssr-entry.js',
    { environment: 'ssr' }
  );

  return ssrEntry.handleSsr(rscStream, navContext);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default createRequestHandler(routeManifest, config);
