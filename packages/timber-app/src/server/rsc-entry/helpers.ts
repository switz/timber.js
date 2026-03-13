/**
 * RSC Entry Helpers — shared utilities for the RSC request handler.
 *
 * Small, stateless functions used across the RSC entry modules.
 */

import type { ManifestSegmentNode } from '../route-matcher.js';
import { RedirectSignal } from '../primitives.js';

/** RSC content type for client navigation payload requests. */
export const RSC_CONTENT_TYPE = 'text/x-component';

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
export function createDebugChannelSink(): { readable: ReadableStream; writable: WritableStream } {
  const sink = new TransformStream();
  // Drain the readable side so the writable never back-pressures.
  sink.readable.pipeTo(new WritableStream()).catch(() => {});
  return {
    readable: new ReadableStream(), // no commands to send to Flight
    writable: sink.writable,
  };
}

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
export function buildSegmentInfo(
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
export function isRscPayloadRequest(req: Request): boolean {
  const accept = req.headers.get('Accept') ?? '';
  return accept.includes(RSC_CONTENT_TYPE);
}

/**
 * Build a redirect Response. For RSC payload requests (client navigation),
 * return 204 + X-Timber-Redirect header instead of a raw 302. The browser's
 * fetch with redirect: "manual" turns a 302 into an opaque redirect (status 0,
 * null body, inaccessible headers), which crashes createFromFetch when it
 * tries to call .body.getReader(). The X-Timber-Redirect header lets the
 * client detect the redirect and perform a soft SPA navigation.
 */
export function buildRedirectResponse(
  req: Request,
  signal: RedirectSignal,
  responseHeaders: Headers
): Response {
  if (isRscPayloadRequest(req)) {
    responseHeaders.set('X-Timber-Redirect', signal.location);
    return new Response(null, { status: 204, headers: responseHeaders });
  }
  responseHeaders.set('Location', signal.location);
  return new Response(null, { status: signal.status, headers: responseHeaders });
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
