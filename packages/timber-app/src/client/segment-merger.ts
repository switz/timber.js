/**
 * Segment Merger — client-side tree merging for partial RSC payloads.
 *
 * When the server skips rendering sync layouts (because the client already
 * has them cached), the RSC payload is missing outer segment wrappers.
 * This module reconstructs the full element tree by splicing the partial
 * payload into cached segment subtrees.
 *
 * The approach:
 * 1. After each full RSC payload render, walk the decoded element tree
 *    and cache each segment's subtree (identified by SegmentProvider boundaries)
 * 2. When a partial payload arrives, wrap it with cached segment elements
 *    using React.cloneElement to preserve component identity
 *
 * React.cloneElement preserves the element's `type` — React sees the same
 * component at the same tree position and reconciles (preserving state)
 * rather than remounting. This is how layout state survives navigations.
 *
 * Design docs: 19-client-navigation.md §"Navigation Reconciliation"
 * Security: access.ts runs on the server regardless of skipping — this
 *           is a performance optimization only. See 13-security.md.
 */

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────────────

/**
 * A cached segment entry. Stores the full subtree rooted at a SegmentProvider
 * and the path through the tree to the next SegmentProvider (or leaf).
 */
export interface CachedSegmentEntry {
  /** The segment's URL path (e.g., "/", "/dashboard") */
  segmentPath: string;
  /** The SegmentProvider element for this segment */
  element: ReactElement;
  /**
   * Whether this segment's cached element contains a nested SegmentProvider.
   * Only segments with inner SegmentProviders are safe to skip — the merger
   * can only replace inner SegmentProviders, not pages embedded in layout output.
   * Used by the state tree serialization to exclude non-mergeable segments.
   */
  hasMergeableChild: boolean;
}

// ─── Segment Element Cache ───────────────────────────────────────

/**
 * Cache of React element subtrees per segment path.
 * Updated after each navigation with the full decoded RSC element tree.
 */
export class SegmentElementCache {
  private entries = new Map<string, CachedSegmentEntry>();

  get(segmentPath: string): CachedSegmentEntry | undefined {
    return this.entries.get(segmentPath);
  }

  set(segmentPath: string, entry: CachedSegmentEntry): void {
    this.entries.set(segmentPath, entry);
  }

  has(segmentPath: string): boolean {
    return this.entries.has(segmentPath);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Get the set of segment paths that are safe for the server to skip.
   * Only segments with an inner SegmentProvider (hasMergeableChild) are
   * included — the merger can only replace inner SegmentProviders, not
   * pages embedded in layout output. Used to filter the state tree.
   *
   * Returns an empty set if the element cache is empty (no elements
   * cached yet). This is the safe default — an empty set means no
   * segments pass the filter, so the state tree is empty and the server
   * does a full render. The element cache is populated lazily after the
   * first SPA navigation (RSC-decoded elements from hydration are
   * thenables that can't be walked until React resolves them).
   */
  getMergeablePaths(): Set<string> {
    const paths = new Set<string>();
    for (const [, entry] of this.entries) {
      if (entry.hasMergeableChild) {
        paths.add(entry.segmentPath);
      }
    }
    return paths;
  }
}

// ─── SegmentProvider Detection ───────────────────────────────────

/**
 * Check if a React element is a SegmentProvider by looking for the
 * `segments` prop (an array of path segments). This is the only
 * component that receives this prop shape.
 */
export function isSegmentProvider(element: unknown): element is ReactElement {
  if (!isValidElement(element)) return false;
  const props = element.props as Record<string, unknown>;
  return Array.isArray(props.segments);
}

/**
 * Extract the segment path from a SegmentProvider element.
 *
 * Uses the `segmentId` prop if available (set by the server for route groups
 * to distinguish siblings that share the same urlPath). Falls back to
 * reconstructing from the `segments` array prop.
 */
export function getSegmentPath(element: ReactElement): string {
  const props = element.props as { segments: string[]; segmentId?: string };
  // segmentId is the authoritative key — includes group name for route groups
  if (props.segmentId) return props.segmentId;
  const filtered = props.segments.filter(Boolean);
  return filtered.length === 0 ? '/' : '/' + filtered.join('/');
}

// ─── Tree Walking ────────────────────────────────────────────────

/**
 * Walk a React element tree and extract all SegmentProvider boundaries.
 * Returns an ordered list of segment entries from outermost to innermost.
 *
 * This only finds SegmentProviders along the main children path — it does
 * not descend into parallel routes/slots (those are separate subtrees).
 */
export function extractSegments(element: unknown): CachedSegmentEntry[] {
  const segments: CachedSegmentEntry[] = [];
  walkForSegments(element, segments);
  // Compute hasMergeableChild: a segment is mergeable if there's another
  // SegmentProvider nested below it. The segments list is ordered outermost
  // to innermost, so each segment's child is the next entry.
  for (let i = 0; i < segments.length; i++) {
    segments[i].hasMergeableChild = i < segments.length - 1;
  }
  return segments;
}

function walkForSegments(node: unknown, out: CachedSegmentEntry[]): void {
  if (!isValidElement(node)) return;

  // Use a local binding to avoid TypeScript narrowing issues with
  // isSegmentProvider's type predicate on the same variable.
  const el: ReactElement = node as ReactElement;
  const props = el.props as Record<string, unknown>;

  if (isSegmentProvider(node)) {
    out.push({
      segmentPath: getSegmentPath(el),
      element: el,
      hasMergeableChild: false, // computed after collection in extractSegments
    });
    // Continue walking into children to find nested segments
    walkChildren(props.children as ReactNode, out);
    return;
  }

  // Not a SegmentProvider — walk children looking for one
  walkChildren(props.children as ReactNode, out);
}

function walkChildren(children: ReactNode, out: CachedSegmentEntry[]): void {
  if (children == null) return;

  if (Array.isArray(children)) {
    for (const child of children) {
      walkForSegments(child, out);
    }
  } else {
    walkForSegments(children, out);
  }
}

// ─── Cache Population ────────────────────────────────────────────

/**
 * Cache all segment subtrees from a fully-rendered RSC element tree.
 * Call this after every full RSC payload render (navigate, refresh, hydration).
 */
export function cacheSegmentElements(
  element: unknown,
  cache: SegmentElementCache
): void {
  const segments = extractSegments(element);
  for (const entry of segments) {
    cache.set(entry.segmentPath, entry);
  }
}

// ─── Tree Merging ────────────────────────────────────────────────

/**
 * Find a SegmentProvider nested in the children of a React element.
 * Returns the path of elements from the given element down to the
 * SegmentProvider, enabling reconstruction via cloneElement.
 *
 * The path is an array of [element, childIndex] pairs. childIndex is -1
 * for single-child (non-array) props.children.
 */
type TreePath = Array<{ element: ReactElement; childIndex: number }>;

function findSegmentProviderPath(
  node: ReactElement,
  targetPath?: string
): TreePath | null {
  const children = (node.props as { children?: ReactNode }).children;
  if (children == null) return null;

  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!isValidElement(child)) continue;

      if (isSegmentProvider(child)) {
        if (!targetPath || getSegmentPath(child) === targetPath) {
          return [{ element: node, childIndex: i }];
        }
      }

      const deeper = findSegmentProviderPath(child, targetPath);
      if (deeper) {
        return [{ element: node, childIndex: i }, ...deeper];
      }
    }
  } else if (isValidElement(children)) {
    if (isSegmentProvider(children)) {
      if (!targetPath || getSegmentPath(children) === targetPath) {
        return [{ element: node, childIndex: -1 }];
      }
    }

    const deeper = findSegmentProviderPath(children, targetPath);
    if (deeper) {
      return [{ element: node, childIndex: -1 }, ...deeper];
    }
  }

  return null;
}

/**
 * Replace a nested SegmentProvider within a cached element tree with
 * new content. Uses cloneElement along the path to produce a new tree
 * with preserved component identity at every level except the replaced node.
 *
 * @param cachedElement The cached SegmentProvider element for this segment
 * @param newInnerContent The new React element to splice in at the inner segment position
 * @param innerSegmentPath The path of the inner segment to replace (optional — replaces first found)
 * @returns New element tree with the inner segment replaced
 */
export function replaceInnerSegment(
  cachedElement: ReactElement,
  newInnerContent: ReactNode,
  innerSegmentPath?: string
): ReactElement {
  const path = findSegmentProviderPath(cachedElement, innerSegmentPath);

  if (!path || path.length === 0) {
    // No inner SegmentProvider found — this segment's cached element
    // wraps a page directly (no child layout with a SegmentProvider).
    // We CANNOT safely replace the page because it's embedded deep in
    // the layout's server-rendered output tree and we don't know its
    // position. Return the cached element unchanged as a safety fallback.
    //
    // The server should not skip segments without a child layout below
    // them (enforced by hasRenderedLayoutBelow in buildRouteElement).
    // If this codepath is reached, it indicates a server/client mismatch.
    return cachedElement;
  }

  // Reconstruct bottom-up: replace the innermost element first, then
  // clone each ancestor with the updated child.
  let replacement: ReactNode = newInnerContent;

  for (let i = path.length - 1; i >= 0; i--) {
    const { element, childIndex } = path[i];

    if (childIndex === -1) {
      // Single child — replace it
      replacement = cloneElement(element, {}, replacement);
    } else {
      // Array children — replace the specific index
      const children = (element.props as { children: ReactNode[] }).children;
      const newChildren = [...children];
      newChildren[childIndex] = replacement;
      replacement = cloneElement(element, {}, ...newChildren);
    }
  }

  return replacement as ReactElement;
}

/**
 * Merge a partial RSC payload with cached segment elements.
 *
 * When the server skips segments, the partial payload starts from the
 * first non-skipped segment. This function wraps it with cached elements
 * for the skipped segments, producing a full tree that React can
 * reconcile with the mounted tree (preserving layout state).
 *
 * @param partialPayload The RSC payload element (may be partial)
 * @param skippedSegments Ordered list of segment paths that were skipped (outermost first)
 * @param cache The segment element cache
 * @returns The merged full element tree, or the partial payload if merging isn't possible
 */
export function mergeSegmentTree(
  partialPayload: unknown,
  skippedSegments: string[],
  cache: SegmentElementCache
): unknown {
  if (!isValidElement(partialPayload)) return partialPayload;
  if (skippedSegments.length === 0) return partialPayload;

  // Build from outermost to innermost: each skipped segment's cached
  // element wraps the next, with the partial payload at the center.
  let result: ReactNode = partialPayload;

  // Process from innermost skipped segment to outermost
  for (let i = skippedSegments.length - 1; i >= 0; i--) {
    const segmentPath = skippedSegments[i];
    const cached = cache.get(segmentPath);

    if (!cached) {
      // No cached element for this segment — can't merge.
      // This shouldn't happen (server only skips segments the client
      // has cached), but if it does, return the partial payload as-is.
      return partialPayload;
    }

    // Replace the inner content of the cached segment with our current result.
    // The inner content is either the next SegmentProvider or the page.
    result = replaceInnerSegment(cached.element, result);
  }

  return result;
}
