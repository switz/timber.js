/**
 * RSC API Route Handler — handles route.ts requests (non-React).
 *
 * Runs access.ts standalone for all segments in the chain (no React render
 * pass, no AccessGate component). Then dispatches to the route handler.
 * See design/04-authorization.md §"Auth in API Routes".
 */

import { withSpan, setSpanAttribute } from '../tracing.js';
import type { ManifestSegmentNode } from '../route-matcher.js';
import type { RouteMatch } from '../pipeline.js';
import { DenySignal, RedirectSignal } from '../primitives.js';
import { handleRouteRequest } from '../route-handler.js';
import type { RouteModule } from '../route-handler.js';
import type { RouteContext } from '../types.js';

export async function handleApiRoute(
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
  const { resolveManifestStatusFile } = await import('../manifest-status-resolver.js');

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
