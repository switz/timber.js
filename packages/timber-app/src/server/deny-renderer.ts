/**
 * Deny page rendering — renders status-code pages for DenySignal errors.
 *
 * Extracted from rsc-entry.ts to keep file sizes under 500 lines.
 * Handles both full HTML rendering (via SSR) and raw RSC Flight stream
 * rendering (for client navigation).
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
 * Render a status-code error page for a DenySignal.
 *
 * Resolves the appropriate status-code file (e.g. 404.tsx, 403.tsx) from the
 * segment chain, renders it through a fresh RSC→SSR pipeline, and returns
 * an HTML Response with the correct status code.
 *
 * Falls back to a bare Response(null, { status }) when no status-code page
 * exists in the segment chain.
 */
export async function renderDenyPage(
  deny: DenySignal,
  segments: ManifestSegmentNode[],
  layoutComponents: LayoutEntry[],
  req: Request,
  match: RouteMatch,
  responseHeaders: Headers,
  scriptsHtml: string,
  createDebugChannelSink: DebugChannelFactory,
  callSsr: CallSsrFn
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
export async function renderDenyPageAsRsc(
  deny: DenySignal,
  segments: ManifestSegmentNode[],
  layoutComponents: LayoutEntry[],
  responseHeaders: Headers,
  createDebugChannelSink: DebugChannelFactory
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
