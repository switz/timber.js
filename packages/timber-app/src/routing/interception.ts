/**
 * Intercepting route utilities.
 *
 * Computes rewrite rules from the route tree that enable intercepting routes
 * to conditionally render when navigating via client-side (soft) navigation.
 *
 * The mechanism: at build time, each intercepting route directory generates a
 * conditional rewrite. On soft navigation, the client sends an `X-Timber-URL`
 * header with the current pathname. The server checks if any rewrite's source
 * (the intercepted URL) matches the target pathname AND the header matches
 * the intercepting route's parent URL. If both match, the intercepting route
 * renders instead of the normal route.
 *
 * On hard navigation (no header), no rewrite matches, and the normal route
 * renders.
 *
 * See design/07-routing.md §"Intercepting Routes"
 */

import type { SegmentNode, InterceptionMarker } from './types.js';

/** A conditional rewrite rule generated from an intercepting route. */
export interface InterceptionRewrite {
  /**
   * The URL pattern that this rewrite intercepts (the target of navigation).
   * E.g., "/photo/[id]" for a (.)photo/[id] interception.
   */
  interceptedPattern: string;
  /**
   * The URL prefix that the client must be navigating FROM for this rewrite
   * to apply. Matched against the X-Timber-URL header.
   * E.g., "/feed" for a (.)photo/[id] inside /feed/@modal/.
   */
  interceptingPrefix: string;
  /**
   * Segments chain from root → intercepting leaf. Used to build the element
   * tree when the interception is active.
   */
  segmentPath: SegmentNode[];
}

/**
 * Collect all interception rewrite rules from the route tree.
 *
 * Walks the tree recursively. For each intercepting segment, computes the
 * intercepted URL based on the marker and the segment's position.
 */
export function collectInterceptionRewrites(root: SegmentNode): InterceptionRewrite[] {
  const rewrites: InterceptionRewrite[] = [];
  walkForInterceptions(root, [root], rewrites);
  return rewrites;
}

/**
 * Recursively walk the segment tree to find intercepting routes.
 */
function walkForInterceptions(
  node: SegmentNode,
  ancestors: SegmentNode[],
  rewrites: InterceptionRewrite[]
): void {
  // Check children
  for (const child of node.children) {
    if (child.segmentType === 'intercepting' && child.interceptionMarker) {
      // Found an intercepting route — collect rewrites from its sub-tree
      collectFromInterceptingNode(child, ancestors, rewrites);
    } else {
      walkForInterceptions(child, [...ancestors, child], rewrites);
    }
  }

  // Check slots (intercepting routes are typically inside slots like @modal)
  for (const [, slot] of node.slots) {
    walkForInterceptions(slot, ancestors, rewrites);
  }
}

/**
 * For an intercepting segment, find all leaf pages in its sub-tree and
 * generate rewrite rules for each.
 */
function collectFromInterceptingNode(
  interceptingNode: SegmentNode,
  ancestors: SegmentNode[],
  rewrites: InterceptionRewrite[]
): void {
  const marker = interceptingNode.interceptionMarker!;
  const segmentName = interceptingNode.interceptedSegmentName!;

  // Compute the intercepted URL base based on the marker
  const parentUrlPath = ancestors[ancestors.length - 1].urlPath;
  const interceptedBase = computeInterceptedBase(parentUrlPath, marker);
  const interceptedUrlBase =
    interceptedBase === '/' ? `/${segmentName}` : `${interceptedBase}/${segmentName}`;

  // Find all leaf pages in the intercepting sub-tree
  collectLeavesWithRewrites(
    interceptingNode,
    interceptedUrlBase,
    parentUrlPath,
    [...ancestors, interceptingNode],
    rewrites
  );
}

/**
 * Recursively find leaf pages in an intercepting sub-tree and generate
 * rewrite rules for each.
 */
function collectLeavesWithRewrites(
  node: SegmentNode,
  interceptedUrlPath: string,
  interceptingPrefix: string,
  segmentPath: SegmentNode[],
  rewrites: InterceptionRewrite[]
): void {
  if (node.page) {
    rewrites.push({
      interceptedPattern: interceptedUrlPath,
      interceptingPrefix,
      segmentPath: [...segmentPath],
    });
  }

  for (const child of node.children) {
    const childUrl =
      child.segmentType === 'group'
        ? interceptedUrlPath
        : `${interceptedUrlPath}/${child.segmentName}`;
    collectLeavesWithRewrites(
      child,
      childUrl,
      interceptingPrefix,
      [...segmentPath, child],
      rewrites
    );
  }
}

/**
 * Compute the base URL that an intercepting route intercepts, given the
 * parent's URL path and the interception marker.
 *
 * - (.)  — same level: parent's URL path
 * - (..) — one level up: parent's parent URL path
 * - (...) — root level: /
 * - (..)(..) — two levels up: parent's grandparent URL path
 *
 * Level counting operates on URL path segments, NOT filesystem directories.
 * Route groups and parallel slots are already excluded from urlPath (they
 * don't add URL depth), so (..) correctly climbs visible segments. This
 * avoids the Vinext bug where path.dirname() on filesystem paths would
 * waste climbs on invisible route groups.
 */
function computeInterceptedBase(parentUrlPath: string, marker: InterceptionMarker): string {
  switch (marker) {
    case '(.)':
      return parentUrlPath;
    case '(..)': {
      const parts = parentUrlPath.split('/').filter(Boolean);
      parts.pop();
      return parts.length === 0 ? '/' : `/${parts.join('/')}`;
    }
    case '(...)':
      return '/';
    case '(..)(..)': {
      const parts = parentUrlPath.split('/').filter(Boolean);
      parts.pop();
      parts.pop();
      return parts.length === 0 ? '/' : `/${parts.join('/')}`;
    }
  }
}
