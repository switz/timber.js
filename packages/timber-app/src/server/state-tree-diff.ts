/**
 * State Tree Diffing — Server-side parsing and diffing of X-Timber-State-Tree.
 *
 * The client sends X-Timber-State-Tree on navigation requests, listing
 * the sync segments it has cached. The server diffs this against the
 * target route's segments to skip re-rendering unchanged sync layouts.
 *
 * This is a performance optimization only — NOT a security boundary.
 * All access.ts files run regardless of the state tree content.
 * A fabricated state tree can only cause extra rendering work or stale
 * layouts — never auth bypass.
 *
 * See design/19-client-navigation.md §"X-Timber-State-Tree Header"
 * See design/13-security.md §"State tree manipulation"
 */

/**
 * Parse the X-Timber-State-Tree header from a request.
 *
 * Returns a Set of segment paths the client has cached, or null if
 * the header is missing, malformed, or empty. Parsing happens before
 * renderToReadableStream — not inside the React render pass.
 *
 * @returns Set of sync segment paths, or null if no valid state tree
 */
export function parseClientStateTree(req: Request): Set<string> | null {
  const header = req.headers.get('X-Timber-State-Tree');
  if (!header) return null;

  try {
    const parsed = JSON.parse(header) as { segments?: unknown };
    if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
      return null;
    }
    return new Set(parsed.segments as string[]);
  } catch {
    return null;
  }
}

/**
 * Determine whether a segment's layout rendering can be skipped.
 *
 * A segment is skipped when ALL of the following are true:
 * 1. The client has the segment in its state tree (clientSegments contains urlPath)
 * 2. The layout is sync (not an async function — async layouts always re-render)
 * 3. The segment is NOT the leaf (pages are never cached across navigations)
 *
 * Access.ts still runs for skipped segments — this is enforced by the caller
 * (buildRouteElement) which runs all access checks before building the tree.
 *
 * @param urlPath - The segment's URL path (e.g., "/", "/dashboard")
 * @param layoutComponent - The loaded layout component function
 * @param isLeaf - Whether this is the leaf segment (page segment)
 * @param clientSegments - Set of paths from X-Timber-State-Tree, or null
 */
export function shouldSkipSegment(
  _urlPath: string,
  _layoutComponent: ((...args: unknown[]) => unknown) | undefined,
  _isLeaf: boolean,
  _clientSegments: Set<string> | null
): boolean {
  // DISABLED: Client-side segment merging via React element tree walking
  // is too fragile for production. The merger's replaceInnerSegment relies
  // on walking RSC-decoded element trees to find SegmentProvider boundaries,
  // but production trees contain structures the walker can't handle:
  // Suspense wrappers, error boundaries, AccessGate components, React lazy
  // refs, and client component module references.
  //
  // The merger infrastructure (segment-merger.ts, element cache, state tree
  // filtering) is in place and tested. Re-enable when the merger can handle
  // real RSC element trees — likely requires a SegmentOutlet client component
  // approach instead of post-hoc element tree walking.
  //
  // See design/19-client-navigation.md §"X-Timber-State-Tree Header"
  return false;
}
