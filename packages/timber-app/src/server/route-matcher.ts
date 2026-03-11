/**
 * Route matcher — resolves a canonical pathname to a RouteMatch.
 *
 * Walks the manifest segment tree to find the best matching route.
 * Priority: static > dynamic > catch-all > optional-catch-all.
 * Groups are transparent (don't add URL depth).
 *
 * See design/07-routing.md §"Request Lifecycle"
 */

import type { RouteMatch } from './pipeline.js';
import type { MiddlewareFn } from './middleware-runner.js';

// ─── Manifest Types ───────────────────────────────────────────────────────
// The virtual module manifest has a slightly different shape than SegmentNode:
// file references are { load, filePath } instead of RouteFile.

/** A file reference in the manifest (lazy import + path). */
interface ManifestFile {
  load: () => Promise<unknown>;
  filePath: string;
}

/** A segment node as it appears in the virtual:timber-route-manifest module. */
export interface ManifestSegmentNode {
  segmentName: string;
  segmentType: 'static' | 'dynamic' | 'catch-all' | 'optional-catch-all' | 'group' | 'slot';
  urlPath: string;
  paramName?: string;

  page?: ManifestFile;
  layout?: ManifestFile;
  middleware?: ManifestFile;
  access?: ManifestFile;
  route?: ManifestFile;
  error?: ManifestFile;
  default?: ManifestFile;
  denied?: ManifestFile;
  searchParams?: ManifestFile;
  statusFiles?: Record<string, ManifestFile>;
  jsonStatusFiles?: Record<string, ManifestFile>;
  legacyStatusFiles?: Record<string, ManifestFile>;
  prerender?: ManifestFile;

  children: ManifestSegmentNode[];
  slots: Record<string, ManifestSegmentNode>;
}

/** The manifest shape from virtual:timber-route-manifest. */
export interface ManifestRoot {
  root: ManifestSegmentNode;
  proxy?: ManifestFile;
}

// ─── Matcher ──────────────────────────────────────────────────────────────

/**
 * Create a route matcher function from a manifest.
 *
 * The returned function takes a canonical pathname and returns a RouteMatch
 * or null if no route matches.
 */
export function createRouteMatcher(
  manifest: ManifestRoot
): (pathname: string) => RouteMatch | null {
  return (pathname: string) => matchPathname(manifest.root, pathname);
}

/**
 * Match a canonical pathname against the segment tree.
 *
 * Splits the pathname into segments and walks the tree depth-first.
 * Returns the segment chain and extracted params on match.
 */
function matchPathname(root: ManifestSegmentNode, pathname: string): RouteMatch | null {
  // Split pathname into segments: "/blog/hello-world" → ["blog", "hello-world"]
  // "/" → [] (empty segments)
  const parts = pathname === '/' ? [] : pathname.slice(1).split('/');

  const segments: ManifestSegmentNode[] = [];
  const params: Record<string, string | string[]> = {};

  const matched = matchSegments(root, parts, 0, segments, params);
  if (!matched) return null;

  // Convert ManifestSegmentNodes to the SegmentNode shape expected by RouteMatch.
  // The pipeline and tree builder use SegmentNode which has RouteFile references,
  // but we pass the manifest nodes directly — they're structurally compatible
  // for the fields the pipeline cares about (segments array + params).
  // Resolve the leaf segment's middleware.ts if present.
  // Only the leaf route's middleware runs — no chain, no inheritance.
  const leafSegment = segments[segments.length - 1];
  let middleware: MiddlewareFn | undefined;
  if (leafSegment?.middleware) {
    const loader = leafSegment.middleware.load;
    middleware = async (ctx) => {
      const mod = (await loader()) as { default?: MiddlewareFn };
      if (mod.default) {
        return mod.default(ctx);
      }
    };
  }

  return {
    // The pipeline uses segments as opaque objects passed to the renderer.
    // Cast is safe — the renderer receives what the manifest provides.
    segments: segments as unknown as RouteMatch['segments'],
    params,
    middleware,
  };
}

/**
 * Recursively match URL segments against the segment tree.
 *
 * Priority order for children at each level:
 *   1. Static segments (exact match)
 *   2. Dynamic segments ([param])
 *   3. Catch-all segments ([...param])
 *   4. Optional catch-all segments ([[...param]])
 *
 * Groups are transparent — they don't consume URL segments but their
 * children are checked as if they were direct children of the parent.
 */
function matchSegments(
  node: ManifestSegmentNode,
  parts: string[],
  index: number,
  segments: ManifestSegmentNode[],
  params: Record<string, string | string[]>
): boolean {
  segments.push(node);

  // All parts consumed — check if this node has a page or route
  if (index >= parts.length) {
    if (node.page || node.route) {
      return true;
    }

    // Check group children (they don't consume URL segments)
    for (const child of node.children) {
      if (child.segmentType === 'group') {
        if (matchSegments(child, parts, index, segments, params)) {
          return true;
        }
      }
    }

    // Check optional catch-all children (they can match zero segments)
    for (const child of node.children) {
      if (child.segmentType === 'optional-catch-all') {
        if (child.page || child.route) {
          segments.push(child);
          // Zero segments → param is undefined (not set), matching Next.js semantics
          return true;
        }
      }
    }

    segments.pop();
    return false;
  }

  const part = parts[index];

  // Try children in priority order

  // 1. Static segments
  for (const child of node.children) {
    if (child.segmentType === 'static' && child.segmentName === part) {
      if (matchSegments(child, parts, index + 1, segments, params)) {
        return true;
      }
    }
  }

  // 2. Group segments (transparent — recurse without consuming)
  for (const child of node.children) {
    if (child.segmentType === 'group') {
      if (matchSegments(child, parts, index, segments, params)) {
        return true;
      }
    }
  }

  // 3. Dynamic segments ([param])
  for (const child of node.children) {
    if (child.segmentType === 'dynamic' && child.paramName) {
      const prevParam = params[child.paramName];
      params[child.paramName] = decodeURIComponent(part);
      if (matchSegments(child, parts, index + 1, segments, params)) {
        return true;
      }
      // Backtrack
      if (prevParam !== undefined) {
        params[child.paramName] = prevParam;
      } else {
        delete params[child.paramName];
      }
    }
  }

  // 4. Catch-all segments ([...param])
  for (const child of node.children) {
    if (child.segmentType === 'catch-all' && child.paramName) {
      if (child.page || child.route) {
        const remaining = parts.slice(index).map(decodeURIComponent);
        segments.push(child);
        params[child.paramName] = remaining;
        return true;
      }
    }
  }

  // 5. Optional catch-all segments ([[...param]])
  for (const child of node.children) {
    if (child.segmentType === 'optional-catch-all' && child.paramName) {
      if (child.page || child.route) {
        const remaining = parts.slice(index).map(decodeURIComponent);
        segments.push(child);
        params[child.paramName] = remaining;
        return true;
      }
    }
  }

  segments.pop();
  return false;
}
