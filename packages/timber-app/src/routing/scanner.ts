/**
 * Route discovery scanner.
 *
 * Pure function: (appDir, config) → RouteTree
 *
 * Scans the app/ directory and builds a segment tree recognizing all
 * timber.js file conventions. Does NOT handle request matching — this
 * is discovery only.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import type {
  RouteTree,
  SegmentNode,
  SegmentType,
  RouteFile,
  ScannerConfig,
  InterceptionMarker,
} from './types.js';
import { DEFAULT_PAGE_EXTENSIONS, INTERCEPTION_MARKERS } from './types.js';
import { classifyMetadataRoute } from '#/server/metadata-routes.js';

/**
 * Pattern matching encoded path delimiters that must be rejected during route discovery.
 * %2F / %2f (forward slash) and %5C / %5c (backslash) can cause route collisions
 * when decoded. See design/13-security.md §"Encoded separators rejected".
 */
const ENCODED_SEPARATOR_PATTERN = /%(?:2[fF]|5[cC])/;

/**
 * Pattern matching encoded null bytes (%00) that must be rejected.
 * See design/13-security.md §"Null bytes rejected".
 */
const ENCODED_NULL_PATTERN = /%00/;

/**
 * File convention names that use pageExtensions (can be .tsx, .ts, .jsx, .js, .mdx, etc.)
 */
const PAGE_EXT_CONVENTIONS = new Set(['page', 'layout', 'error', 'default', 'denied']);

/**
 * Legacy compat status-code files.
 * Maps legacy file name → HTTP status code for the fallback chain.
 * See design/10-error-handling.md §"Fallback Chain".
 */
const LEGACY_STATUS_FILES: Record<string, number> = {
  'not-found': 404,
  'forbidden': 403,
  'unauthorized': 401,
};

/**
 * File convention names that are always .ts/.tsx (never .mdx etc.)
 */
const FIXED_CONVENTIONS = new Set(['middleware', 'access', 'route', 'prerender', 'search-params']);

/**
 * Status-code file patterns:
 * - Exact 3-digit codes: 401.tsx, 429.tsx, 503.tsx
 * - Category catch-alls: 4xx.tsx, 5xx.tsx
 */
const STATUS_CODE_PATTERN = /^(\d{3}|[45]xx)$/;

/**
 * Scan the app/ directory and build the route tree.
 *
 * @param appDir - Absolute path to the app/ directory
 * @param config - Scanner configuration
 * @returns The complete route tree
 */
export function scanRoutes(appDir: string, config: ScannerConfig = {}): RouteTree {
  const pageExtensions = config.pageExtensions ?? DEFAULT_PAGE_EXTENSIONS;
  const extSet = new Set(pageExtensions);

  const tree: RouteTree = {
    root: createSegmentNode('', 'static', '/'),
  };

  // Check for proxy.ts at app root
  const proxyFile = findFixedFile(appDir, 'proxy');
  if (proxyFile) {
    tree.proxy = proxyFile;
  }

  // Scan the root directory's files
  scanSegmentFiles(appDir, tree.root, extSet);

  // Scan children recursively
  scanChildren(appDir, tree.root, extSet);

  // Validate: detect route group collisions (different groups producing pages at the same URL)
  validateRouteGroupCollisions(tree.root);

  return tree;
}

/**
 * Create an empty segment node.
 */
function createSegmentNode(
  segmentName: string,
  segmentType: SegmentType,
  urlPath: string,
  paramName?: string,
  interceptionMarker?: InterceptionMarker,
  interceptedSegmentName?: string
): SegmentNode {
  return {
    segmentName,
    segmentType,
    urlPath,
    paramName,
    interceptionMarker,
    interceptedSegmentName,
    children: [],
    slots: new Map(),
  };
}

/**
 * Classify a directory name into its segment type.
 */
export function classifySegment(dirName: string): {
  type: SegmentType;
  paramName?: string;
  interceptionMarker?: InterceptionMarker;
  interceptedSegmentName?: string;
} {
  // Private folder: _name (excluded from routing)
  if (dirName.startsWith('_')) {
    return { type: 'private' };
  }

  // Parallel route slot: @name
  if (dirName.startsWith('@')) {
    return { type: 'slot' };
  }

  // Intercepting routes: (.)name, (..)name, (...)name, (..)(..)name
  // Check before route groups since intercepting markers also start with (
  const interception = parseInterceptionMarker(dirName);
  if (interception) {
    return {
      type: 'intercepting',
      interceptionMarker: interception.marker,
      interceptedSegmentName: interception.segmentName,
    };
  }

  // Route group: (name)
  if (dirName.startsWith('(') && dirName.endsWith(')')) {
    return { type: 'group' };
  }

  // Optional catch-all: [[...name]]
  if (dirName.startsWith('[[...') && dirName.endsWith(']]')) {
    const paramName = dirName.slice(5, -2);
    return { type: 'optional-catch-all', paramName };
  }

  // Catch-all: [...name]
  if (dirName.startsWith('[...') && dirName.endsWith(']')) {
    const paramName = dirName.slice(4, -1);
    return { type: 'catch-all', paramName };
  }

  // Dynamic: [name]
  if (dirName.startsWith('[') && dirName.endsWith(']')) {
    const paramName = dirName.slice(1, -1);
    return { type: 'dynamic', paramName };
  }

  return { type: 'static' };
}

/**
 * Parse an interception marker from a directory name.
 *
 * Returns the marker and the remaining segment name, or null if not an
 * intercepting route. Markers are checked longest-first to avoid (..)
 * matching before (..)(..).
 *
 * Examples:
 *   "(.)photo"      → { marker: "(.)", segmentName: "photo" }
 *   "(..)feed"      → { marker: "(..)", segmentName: "feed" }
 *   "(...)photos"   → { marker: "(...)", segmentName: "photos" }
 *   "(..)(..)admin" → { marker: "(..)(..)", segmentName: "admin" }
 *   "(marketing)"   → null (route group, not interception)
 */
function parseInterceptionMarker(
  dirName: string
): { marker: InterceptionMarker; segmentName: string } | null {
  for (const marker of INTERCEPTION_MARKERS) {
    if (dirName.startsWith(marker)) {
      const rest = dirName.slice(marker.length);
      // Must have a segment name after the marker, and the rest must not
      // be empty or end with ) (which would be a route group like "(auth)")
      if (rest.length > 0 && !rest.endsWith(')')) {
        return { marker, segmentName: rest };
      }
    }
  }
  return null;
}

/**
 * Compute the URL path for a child segment given its parent's URL path.
 * Route groups, slots, and intercepting routes do NOT add URL depth.
 */
function computeUrlPath(parentUrlPath: string, dirName: string, segmentType: SegmentType): string {
  // Groups, slots, and intercepting routes don't add to URL path
  if (segmentType === 'group' || segmentType === 'slot' || segmentType === 'intercepting') {
    return parentUrlPath;
  }

  const parentPath = parentUrlPath === '/' ? '' : parentUrlPath;
  return `${parentPath}/${dirName}`;
}

/**
 * Scan a directory for file conventions and populate the segment node.
 */
function scanSegmentFiles(dirPath: string, node: SegmentNode, extSet: Set<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);

    // Skip directories — handled by scanChildren
    try {
      if (statSync(fullPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const ext = extname(entry).slice(1); // remove leading dot
    const name = basename(entry, `.${ext}`);

    // Page-extension conventions (page, layout, error, default, denied)
    if (PAGE_EXT_CONVENTIONS.has(name) && extSet.has(ext)) {
      const file: RouteFile = { filePath: fullPath, extension: ext };
      switch (name) {
        case 'page':
          node.page = file;
          break;
        case 'layout':
          node.layout = file;
          break;
        case 'error':
          node.error = file;
          break;
        case 'default':
          node.default = file;
          break;
        case 'denied':
          node.denied = file;
          break;
      }
      continue;
    }

    // Fixed conventions (middleware, access, route) — always .ts or .tsx
    if (FIXED_CONVENTIONS.has(name) && /\.?[jt]sx?$/.test(ext)) {
      const file: RouteFile = { filePath: fullPath, extension: ext };
      switch (name) {
        case 'middleware':
          node.middleware = file;
          break;
        case 'access':
          node.access = file;
          break;
        case 'route':
          node.route = file;
          break;
        case 'prerender':
          node.prerender = file;
          break;
        case 'search-params':
          node.searchParams = file;
          break;
      }
      continue;
    }

    // JSON status-code files (401.json, 4xx.json, 503.json, 5xx.json)
    // Recognized regardless of pageExtensions — .json is a data format, not a page extension.
    if (STATUS_CODE_PATTERN.test(name) && ext === 'json') {
      if (!node.jsonStatusFiles) {
        node.jsonStatusFiles = new Map();
      }
      node.jsonStatusFiles.set(name, { filePath: fullPath, extension: ext });
      continue;
    }

    // Status-code files (401.tsx, 4xx.tsx, 503.tsx, 5xx.tsx)
    if (STATUS_CODE_PATTERN.test(name) && extSet.has(ext)) {
      if (!node.statusFiles) {
        node.statusFiles = new Map();
      }
      node.statusFiles.set(name, { filePath: fullPath, extension: ext });
      continue;
    }

    // Legacy compat files (not-found.tsx, forbidden.tsx, unauthorized.tsx)
    if (name in LEGACY_STATUS_FILES && extSet.has(ext)) {
      if (!node.legacyStatusFiles) {
        node.legacyStatusFiles = new Map();
      }
      node.legacyStatusFiles.set(name, { filePath: fullPath, extension: ext });
      continue;
    }

    // Metadata route files (sitemap.ts, robots.ts, icon.tsx, opengraph-image.tsx, etc.)
    // See design/16-metadata.md §"Metadata Routes"
    const metaInfo = classifyMetadataRoute(entry);
    if (metaInfo) {
      if (!node.metadataRoutes) {
        node.metadataRoutes = new Map();
      }
      node.metadataRoutes.set(name, { filePath: fullPath, extension: ext });
    }
  }

  // Validate: route.ts + page.* is a hard build error
  if (node.route && node.page) {
    throw new Error(
      `Build error: route.ts and page.* cannot coexist in the same segment.\n` +
        `  route.ts: ${node.route.filePath}\n` +
        `  page:     ${node.page.filePath}\n` +
        `A URL is either an API endpoint or a rendered page, not both.`
    );
  }
}

/**
 * Recursively scan child directories and build the segment tree.
 */
function scanChildren(dirPath: string, parentNode: SegmentNode, extSet: Set<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);

    try {
      if (!statSync(fullPath).isDirectory()) continue;
    } catch {
      continue;
    }

    // Reject directories with encoded path delimiters or null bytes.
    // These can cause route collisions when decoded at the URL boundary.
    // See design/13-security.md §"Encoded separators rejected" and §"Null bytes rejected".
    if (ENCODED_SEPARATOR_PATTERN.test(entry)) {
      throw new Error(
        `Build error: directory name contains an encoded path delimiter (%%2F or %%5C).\n` +
          `  Directory: ${fullPath}\n` +
          `Encoded separators in directory names cause route collisions when decoded. ` +
          `Rename the directory to remove the encoded delimiter.`
      );
    }
    if (ENCODED_NULL_PATTERN.test(entry)) {
      throw new Error(
        `Build error: directory name contains an encoded null byte (%%00).\n` +
          `  Directory: ${fullPath}\n` +
          `Encoded null bytes in directory names are not allowed. ` +
          `Rename the directory to remove the null byte encoding.`
      );
    }

    const { type, paramName, interceptionMarker, interceptedSegmentName } = classifySegment(entry);

    // Skip private folders — underscore-prefixed dirs are excluded from routing
    if (type === 'private') continue;

    const urlPath = computeUrlPath(parentNode.urlPath, entry, type);
    const childNode = createSegmentNode(
      entry,
      type,
      urlPath,
      paramName,
      interceptionMarker,
      interceptedSegmentName
    );

    // Scan this segment's files
    scanSegmentFiles(fullPath, childNode, extSet);

    // Recurse into subdirectories
    scanChildren(fullPath, childNode, extSet);

    // Attach to parent: slots go into slots map, everything else is a child
    if (type === 'slot') {
      const slotName = entry.slice(1); // remove @
      parentNode.slots.set(slotName, childNode);
    } else {
      parentNode.children.push(childNode);
    }
  }
}

/**
 * Validate that route groups don't produce conflicting pages/routes at the same URL path.
 *
 * Two route groups like (auth)/login/page.tsx and (marketing)/login/page.tsx both claim
 * /login — the scanner must detect and reject this at build time.
 *
 * Parallel slots are excluded from collision detection — they intentionally coexist at
 * the same URL path as their parent (that's the whole point of parallel routes).
 */
function validateRouteGroupCollisions(root: SegmentNode): void {
  // Map from urlPath → { filePath, source } for the first page/route seen at that path
  const seen = new Map<string, { filePath: string; segmentPath: string }>();
  collectRoutableLeaves(root, seen, '', false);
}

/**
 * Walk the segment tree and collect all routable leaves (page or route files),
 * throwing on collision. Slots are tracked in their own collision space since
 * they are parallel routes that intentionally share URL paths with their parent.
 */
function collectRoutableLeaves(
  node: SegmentNode,
  seen: Map<string, { filePath: string; segmentPath: string }>,
  segmentPath: string,
  insideSlot: boolean
): void {
  const currentPath = segmentPath
    ? `${segmentPath}/${node.segmentName}`
    : node.segmentName || '(root)';

  // Only check collisions for non-slot pages — slots intentionally share URL paths
  if (!insideSlot) {
    const routableFile = node.page ?? node.route;
    if (routableFile) {
      const existing = seen.get(node.urlPath);
      if (existing) {
        throw new Error(
          `Build error: route collision — multiple route groups produce a page/route at the same URL path.\n` +
            `  URL path: ${node.urlPath}\n` +
            `  File 1:   ${existing.filePath} (via ${existing.segmentPath})\n` +
            `  File 2:   ${routableFile.filePath} (via ${currentPath})\n` +
            `Each URL path must map to exactly one page or route handler. ` +
            `Rename or move one of the conflicting files.`
        );
      }
      seen.set(node.urlPath, { filePath: routableFile.filePath, segmentPath: currentPath });
    }
  }

  // Recurse into children
  for (const child of node.children) {
    collectRoutableLeaves(child, seen, currentPath, insideSlot);
  }

  // Recurse into slots — each slot is its own parallel route space
  for (const [, slotNode] of node.slots) {
    collectRoutableLeaves(slotNode, seen, currentPath, true);
  }
}

/**
 * Find a fixed-extension file (proxy.ts) in a directory.
 */
function findFixedFile(dirPath: string, name: string): RouteFile | undefined {
  for (const ext of ['ts', 'tsx']) {
    const fullPath = join(dirPath, `${name}.${ext}`);
    try {
      if (statSync(fullPath).isFile()) {
        return { filePath: fullPath, extension: ext };
      }
    } catch {
      // File doesn't exist
    }
  }
  return undefined;
}
