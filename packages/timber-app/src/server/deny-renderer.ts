/**
 * Deny page rendering — renders status-code pages for DenySignal errors.
 *
 * Extracted from rsc-entry.ts to keep file sizes under 500 lines.
 * Handles three rendering paths:
 * 1. Component (TSX/MDX) with shell — full RSC→SSR through layout chain
 * 2. Component (TSX/MDX) without shell — RSC→SSR standalone (no layouts)
 * 3. JSON — raw file contents returned verbatim, no React pipeline
 *
 * Format selection:
 * - Route handlers (route.ts) prefer JSON variants
 * - Page routes prefer component variants
 * - Accept: application/json on page routes falls back to JSON if no component exists
 *
 * See design/10-error-handling.md §"Status-Code Files"
 */

import { createElement } from 'react';
import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc';

import { DenySignal } from './primitives.js';
import { logRenderError } from './logger.js';
import { resolveMetadata, renderMetadataToElements } from './metadata.js';
import { resolveManifestStatusFile } from './manifest-status-resolver.js';
import type { ManifestSegmentNode } from './route-matcher.js';
import type { RouteMatch } from './pipeline.js';
import type { NavContext } from './ssr-entry.js';
import type { ClientBootstrapConfig } from './html-injectors.js';
import type { Metadata } from './types.js';

/** RSC content type for client navigation payload requests. */
const RSC_CONTENT_TYPE = 'text/x-component';

/** Layout component entry for deny page wrapping. */
export interface LayoutEntry {
  component: (...args: unknown[]) => unknown;
  segment: ManifestSegmentNode;
}

/** Callback to create a debug channel sink for RSC rendering. */
export type DebugChannelFactory = () => {
  readable: ReadableStream;
  writable: WritableStream;
};

/** Callback to pass RSC stream to SSR for HTML rendering. */
export type CallSsrFn = (
  rscStream: ReadableStream<Uint8Array>,
  navContext: NavContext
) => Promise<Response>;

/**
 * Check if the leaf segment is an API route (has route.ts).
 */
function isApiRoute(segments: ReadonlyArray<ManifestSegmentNode>): boolean {
  const leaf = segments[segments.length - 1];
  return !!leaf?.route;
}

/**
 * Render a status-code error page for a DenySignal.
 *
 * Resolves the appropriate status-code file from the segment chain based
 * on format preference. Returns an HTML Response (component), JSON Response,
 * or bare fallback Response.
 */
export async function renderDenyPage(
  deny: DenySignal,
  segments: ManifestSegmentNode[],
  layoutComponents: LayoutEntry[],
  req: Request,
  match: RouteMatch,
  responseHeaders: Headers,
  clientBootstrap: ClientBootstrapConfig,
  createDebugChannelSink: DebugChannelFactory,
  callSsr: CallSsrFn
): Promise<Response> {
  // API routes (route.ts) → JSON only, never render components
  if (isApiRoute(segments)) {
    const jsonResponse = await renderDenyPageJson(deny, segments, responseHeaders);
    if (jsonResponse) return jsonResponse;
    return bareJsonResponse(deny.status, responseHeaders);
  }

  // Page routes → component chain first, JSON fallback only if no component found.
  const resolution = resolveManifestStatusFile(deny.status, segments, 'component');

  // No component status file — try JSON chain before bare fallback
  if (!resolution) {
    const jsonResponse = await renderDenyPageJson(deny, segments, responseHeaders);
    if (jsonResponse) return jsonResponse;
    return new Response(null, { status: deny.status, headers: responseHeaders });
  }

  // Dev warning: JSON status file exists but is shadowed by the component chain.
  // This helps developers understand why their .json file isn't being served.
  if (process.env.NODE_ENV !== 'production') {
    const jsonResolution = resolveManifestStatusFile(deny.status, segments, 'json');
    if (jsonResolution) {
      console.warn(
        `[timber] ${jsonResolution.file.filePath} exists but is shadowed by ` +
          `${resolution.file.filePath} (component chain). ` +
          `For page routes, component status files take priority over JSON. ` +
          `Remove the component file or move it to use the JSON variant.`
      );
    }
  }

  // Load the status-code page component
  const mod = (await resolution.file.load()) as Record<string, unknown>;
  if (!mod.default) {
    return new Response(null, { status: deny.status, headers: responseHeaders });
  }

  const ErrorPageComponent = mod.default as (...args: unknown[]) => unknown;
  const h = createElement as (...args: unknown[]) => React.ReactElement;

  // Check shell opt-out: export const shell = false
  const shellEnabled = mod.shell !== false;

  // 4xx status-code pages receive { status, dangerouslyPassData }
  // per design/10-error-handling.md §"Status-Code File Props"
  let element = h(ErrorPageComponent, {
    status: deny.status,
    dangerouslyPassData: deny.data,
  });

  // Wrap in layouts unless shell is explicitly disabled
  if (shellEnabled) {
    const resolvedSegments = new Set(segments.slice(0, resolution.segmentIndex + 1));
    const layoutsToWrap = layoutComponents.filter((lc) => resolvedSegments.has(lc.segment));
    for (let i = layoutsToWrap.length - 1; i >= 0; i--) {
      const { component } = layoutsToWrap[i];
      element = h(component, null, element);
    }
  } else if (process.env.NODE_ENV !== 'production') {
    // Dev-mode: warn if shell=false might conflict with Suspense
    // The actual Suspense boundary check happens at render time in the pipeline.
    // This is a preemptive log for developer awareness.
    console.warn(
      `[timber] Status-code file ${resolution.file.filePath} exports shell = false. ` +
        'If deny() fires inside a Suspense boundary, layouts are already committed and ' +
        'cannot be unwrapped. The shell opt-out will be ignored in that case.'
    );
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
    bootstrapScriptContent: clientBootstrap.bootstrapScriptContent,
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
export async function renderDenyPageAsRsc(
  deny: DenySignal,
  segments: ManifestSegmentNode[],
  layoutComponents: LayoutEntry[],
  responseHeaders: Headers,
  createDebugChannelSink: DebugChannelFactory
): Promise<Response> {
  const resolution = resolveManifestStatusFile(deny.status, segments, 'component');

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

  // Check shell opt-out
  const shellEnabled = mod.shell !== false;

  let element = h(ErrorPageComponent, {
    status: deny.status,
    dangerouslyPassData: deny.data,
  });

  // Wrap in layouts unless shell is explicitly disabled
  if (shellEnabled) {
    const resolvedSegments = new Set(segments.slice(0, resolution.segmentIndex + 1));
    const layoutsToWrap = layoutComponents.filter((lc) => resolvedSegments.has(lc.segment));
    for (let i = layoutsToWrap.length - 1; i >= 0; i--) {
      const { component } = layoutsToWrap[i];
      element = h(component, null, element);
    }
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

// ─── JSON Rendering ─────────────────────────────────────────────────────────

/**
 * Render a JSON status-code file for a DenySignal.
 *
 * JSON status files are returned verbatim with Content-Type: application/json.
 * No React rendering pipeline, no layout wrapping.
 *
 * Returns null if no JSON status file is found (caller should use bare JSON fallback).
 */
async function renderDenyPageJson(
  deny: DenySignal,
  segments: ManifestSegmentNode[],
  responseHeaders: Headers
): Promise<Response | null> {
  const resolution = resolveManifestStatusFile(deny.status, segments, 'json');

  if (!resolution) {
    return null;
  }

  // JSON status files are loaded as modules that export the JSON content.
  // The manifest's load() imports the .json file, which Vite handles as a
  // default export of the parsed JSON object.
  const mod = (await resolution.file.load()) as Record<string, unknown>;
  const jsonContent = mod.default ?? mod;

  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(jsonContent), {
    status: deny.status,
    headers: responseHeaders,
  });
}

/**
 * Return a bare JSON error response when no JSON status file exists.
 * This is the framework default for JSON format requests.
 */
function bareJsonResponse(status: number, responseHeaders: Headers): Response {
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ error: true, status }), {
    status,
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
