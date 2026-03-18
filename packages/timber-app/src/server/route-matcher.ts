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
import {
  METADATA_ROUTE_CONVENTIONS,
  type MetadataRouteType,
} from './metadata-routes.js';

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
  segmentType:
    | 'static'
    | 'dynamic'
    | 'catch-all'
    | 'optional-catch-all'
    | 'group'
    | 'slot'
    | 'intercepting';
  urlPath: string;
  paramName?: string;
  /** For intercepting segments: the marker used, e.g. "(.)". */
  interceptionMarker?: '(.)' | '(..)' | '(...)' | '(..)(..)';
  /** For intercepting segments: the segment name after stripping the marker. */
  interceptedSegmentName?: string;

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
  /** Metadata route files (sitemap.ts, robots.ts, icon.tsx, etc.) keyed by base name */
  metadataRoutes?: Record<string, ManifestFile>;

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
 * An effective child flattened through group segments.
 * Includes the chain of group nodes that must be added to the segments
 * array before the child itself (to preserve the group → child nesting
 * that the renderer expects).
 */
interface EffectiveChild {
  child: ManifestSegmentNode;
  groupChain: ManifestSegmentNode[];
}

/**
 * Collect effective children by flattening through group segments.
 *
 * Groups are transparent for URL matching — their non-group descendants
 * are returned with the chain of group nodes that lead to them. This
 * allows the caller to apply priority ordering (static > dynamic > ...)
 * across all groups uniformly instead of per-group.
 */
function collectEffectiveChildren(
  node: ManifestSegmentNode,
  groupChain: ManifestSegmentNode[] = []
): EffectiveChild[] {
  const result: EffectiveChild[] = [];
  for (const child of node.children) {
    if (child.segmentType === 'group') {
      // Look through the group — its children become effective children
      // with this group prepended to their chain
      const nested = collectEffectiveChildren(child, [...groupChain, child]);
      result.push(...nested);
    } else {
      result.push({ child, groupChain });
    }
  }
  return result;
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
 * Groups are transparent — they don't consume URL segments. Children
 * are flattened through groups so that priority ordering applies across
 * all groups uniformly (a static in group A always beats a dynamic in
 * group B, regardless of group ordering).
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

    // Check optional catch-all children (direct and through groups)
    const effective = collectEffectiveChildren(node);
    for (const { child, groupChain } of effective) {
      if (child.segmentType === 'optional-catch-all') {
        if (child.page || child.route) {
          segments.push(...groupChain, child);
          // Zero segments → param is undefined (not set), matching Next.js semantics
          return true;
        }
      }
    }

    segments.pop();
    return false;
  }

  const part = parts[index];

  // Flatten children through groups so priority ordering applies globally
  // across all groups, not per-group.
  const effective = collectEffectiveChildren(node);

  // 1. Static segments
  for (const { child, groupChain } of effective) {
    if (child.segmentType === 'static' && child.segmentName === part) {
      segments.push(...groupChain);
      if (matchSegments(child, parts, index + 1, segments, params)) {
        return true;
      }
      // Backtrack group chain
      segments.length -= groupChain.length;
    }
  }

  // 2. Dynamic segments ([param])
  for (const { child, groupChain } of effective) {
    if (child.segmentType === 'dynamic' && child.paramName) {
      segments.push(...groupChain);
      const prevParam = params[child.paramName];
      params[child.paramName] = part;
      if (matchSegments(child, parts, index + 1, segments, params)) {
        return true;
      }
      // Backtrack
      segments.length -= groupChain.length;
      if (prevParam !== undefined) {
        params[child.paramName] = prevParam;
      } else {
        delete params[child.paramName];
      }
    }
  }

  // 3. Catch-all segments ([...param])
  for (const { child, groupChain } of effective) {
    if (child.segmentType === 'catch-all' && child.paramName) {
      if (child.page || child.route) {
        const remaining = parts.slice(index);
        segments.push(...groupChain, child);
        params[child.paramName] = remaining;
        return true;
      }
    }
  }

  // 4. Optional catch-all segments ([[...param]])
  for (const { child, groupChain } of effective) {
    if (child.segmentType === 'optional-catch-all' && child.paramName) {
      if (child.page || child.route) {
        const remaining = parts.slice(index);
        segments.push(...groupChain, child);
        params[child.paramName] = remaining;
        return true;
      }
    }
  }

  segments.pop();
  return false;
}

// ─── Metadata Route Matcher ─────────────────────────────────────────────

/** Result of matching a metadata route. */
export interface MetadataRouteMatch {
  /** The metadata route type (sitemap, robots, icon, etc.) */
  type: MetadataRouteType;
  /** Content-Type header for the response. */
  contentType: string;
  /** The manifest file reference for the handler module. */
  file: ManifestFile;
  /** The matched segment (for context/params if needed). */
  segment: ManifestSegmentNode;
}

/**
 * Create a metadata route matcher from a manifest.
 *
 * Walks the segment tree and builds a map from serve paths to handler modules.
 * Metadata routes are matched by exact pathname (e.g., /sitemap.xml, /blog/sitemap.xml).
 *
 * See design/16-metadata.md §"Metadata Routes"
 */
export function createMetadataRouteMatcher(
  manifest: ManifestRoot
): (pathname: string) => MetadataRouteMatch | null {
  // Build a static lookup map: pathname → match info
  const routeMap = new Map<string, MetadataRouteMatch>();
  collectMetadataRoutes(manifest.root, routeMap);

  return (pathname: string) => routeMap.get(pathname) ?? null;
}

/**
 * Recursively collect metadata routes from the segment tree into a lookup map.
 */
function collectMetadataRoutes(
  node: ManifestSegmentNode,
  map: Map<string, MetadataRouteMatch>
): void {
  if (node.metadataRoutes) {
    for (const [baseName, file] of Object.entries(node.metadataRoutes)) {
      const convention = METADATA_ROUTE_CONVENTIONS[baseName];
      if (!convention) continue;

      // Non-nestable routes (robots, manifest, favicon) only serve from root
      if (!convention.nestable && node.urlPath !== '/') continue;

      // Build the serve pathname: segment urlPath + serve path
      const prefix = node.urlPath === '/' ? '' : node.urlPath;
      const pathname = `${prefix}/${convention.servePath}`;

      map.set(pathname, {
        type: convention.type,
        contentType: convention.contentType,
        file,
        segment: node,
      });
    }
  }

  for (const child of node.children) {
    collectMetadataRoutes(child, map);
  }

  // Also check inside group segments (they're transparent for URL paths)
  for (const slotNode of Object.values(node.slots)) {
    collectMetadataRoutes(slotNode, map);
  }
}
