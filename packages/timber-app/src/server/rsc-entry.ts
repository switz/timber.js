/**
 * RSC Entry — Request handler for the RSC environment.
 *
 * This is a real TypeScript file, not codegen. It imports the route
 * manifest from a virtual module and creates the request handler.
 *
 * Design docs: 18-build-system.md §"Entry Files", 02-rendering-pipeline.md
 */

// @ts-expect-error — virtual module provided by timber-routing plugin
import routeManifest from 'virtual:timber-route-manifest';
// @ts-expect-error — virtual module provided by timber-entries plugin
import config from 'virtual:timber-config';

import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';

import { createPipeline } from './pipeline.js';
import type { PipelineConfig, RouteMatch } from './pipeline.js';
import { createRouteMatcher } from './route-matcher.js';
import type { ManifestSegmentNode } from './route-matcher.js';
import { resolveMetadata, renderMetadataToElements } from './metadata.js';
import type { Metadata } from './types.js';
import { DenySignal } from './primitives.js';
import { injectHead, injectScripts, buildClientScripts } from './html-injectors.js';

/**
 * Create the RSC request handler from the route manifest.
 *
 * The pipeline handles: proxy.ts → canonicalize → route match →
 * 103 Early Hints → middleware.ts → render.
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
 * Render a matched route to an HTML Response.
 *
 * Loads page and layout components from the segment chain, resolves
 * metadata, and renders via renderToReadableStream.
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

  // Build head HTML
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

  // Track render-phase signals (deny, redirect).
  // DenySignal thrown during shell render causes renderToReadableStream to
  // reject — we catch it and return a bare status-code response.
  let renderStatus = 200;
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await renderToReadableStream(element, {
      onError(error: unknown) {
        if (error instanceof DenySignal) {
          renderStatus = error.status;
          return;
        }
        console.error('[timber] Render error:', error);
      },
    });
  } catch (error) {
    if (error instanceof DenySignal) {
      return new Response(null, { status: error.status });
    }
    throw error;
  }

  // If DenySignal fired during shell render, return bare status response
  if (renderStatus !== 200) {
    return new Response(null, { status: renderStatus });
  }

  // Inject metadata into <head> and client scripts before </body>.
  // The layout already renders <html><head>...</head><body>...</body></html>.
  let outputStream = injectHead(stream, headHtml);
  outputStream = injectScripts(outputStream, scriptsHtml);

  if (!responseHeaders.has('content-type')) {
    responseHeaders.set('content-type', 'text/html; charset=utf-8');
  }

  return new Response(outputStream, {
    status: 200,
    headers: responseHeaders,
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
