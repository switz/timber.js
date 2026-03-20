/**
 * RSC Error & No-Match Renderers — handles error pages and 404s.
 *
 * Renders error.tsx / status files and 404 pages through the RSC → SSR pipeline.
 */

import { createElement } from 'react';
import { renderToReadableStream } from '#/rsc-runtime/rsc.js';

import type { RouteMatch } from '#/server/pipeline.js';
import { logRenderError } from '#/server/logger.js';
import type { ManifestSegmentNode } from '#/server/route-matcher.js';
import { DenySignal, RenderError } from '#/server/primitives.js';
import type { ClientBootstrapConfig } from '#/server/html-injectors.js';
import { renderDenyPage } from '#/server/deny-renderer.js';
import type { LayoutEntry } from '#/server/deny-renderer.js';
import type { NavContext } from '#/server/ssr-entry.js';
import { createDebugChannelSink, parseCookiesFromHeader } from './helpers.js';
import { callSsr } from './ssr-bridge.js';

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
export async function renderErrorPage(
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
    cookies: parseCookiesFromHeader(req.headers.get('cookie') ?? ''),
  };

  return callSsr(ssrStream, navContext);
}

/**
 * Render a 404 page for URLs that don't match any route.
 *
 * Uses the root segment's 404.tsx (or 4xx.tsx / error.tsx fallback)
 * wrapped in the root layout, via the same renderDenyPage path
 * used for in-route deny() calls.
 */
export async function renderNoMatchPage(
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
