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
      params[child.paramName] = part;
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
        const remaining = parts.slice(index);
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
        const remaining = parts.slice(index);
        segments.push(child);
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
