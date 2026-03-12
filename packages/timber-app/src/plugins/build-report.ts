/**
 * timber-build-report — Post-build route table output.
 *
 * After a production build completes, logs a summary table showing:
 * - Per-route bundle size (page JS + shared chunks)
 * - Route type classification (static, dynamic, function)
 * - First-load JS size (route-specific + shared chunks)
 *
 * Only active during production builds. Computes sizes from
 * already-generated Vite output — no extra analysis passes.
 *
 * Design docs: 18-build-system.md §"Build Pipeline", 07-routing.md
 * Task: TIM-287
 */

import type { Plugin, Logger } from 'vite';
import type { PluginContext } from '../index.js';
import type { SegmentNode, RouteTree } from '../routing/types.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type RouteType = 'static' | 'dynamic' | 'function';

export interface RouteEntry {
  path: string;
  type: RouteType;
  size: number;
  firstLoadSize: number;
}

/** Map from output chunk fileName to byte size. */
export type ChunkSizeMap = Map<string, number>;

// ─── Route classification ─────────────────────────────────────────────────

const ROUTE_TYPE_ICONS: Record<RouteType, string> = {
  static: '○',
  dynamic: 'λ',
  function: 'ƒ',
};

/**
 * Classify a route based on its segment chain.
 *
 * - `function`: leaf has `route.ts` (API endpoint)
 * - `dynamic`: any segment is dynamic, catch-all, or optional catch-all
 * - `static`: all segments are static or groups
 */
export function classifyRoute(segments: SegmentNode[]): RouteType {
  const leaf = segments[segments.length - 1];

  // Function routes (API endpoints) take precedence
  if (leaf?.route) {
    return 'function';
  }

  // Check for dynamic segments anywhere in the chain
  for (const segment of segments) {
    if (
      segment.segmentType === 'dynamic' ||
      segment.segmentType === 'catch-all' ||
      segment.segmentType === 'optional-catch-all'
    ) {
      return 'dynamic';
    }
  }

  return 'static';
}

// ─── Size formatting ──────────────────────────────────────────────────────

/**
 * Format a byte count to a human-readable string.
 *
 * - Under 1024: "N B"
 * - Under 1 MB: "N.NN kB"
 * - 1 MB and above: "N.NN MB"
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Route tree walking ───────────────────────────────────────────────────

interface RouteInfo {
  /** URL path pattern (e.g. "/dashboard/[id]") */
  path: string;
  /** Segment chain from root to leaf */
  segments: SegmentNode[];
  /** The page or route file path (for chunk mapping) */
  entryFilePath: string | null;
}

/**
 * Walk the route tree and collect all leaf routes (pages and API endpoints).
 *
 * Builds the full segment chain for each route so we can classify it
 * and look up its chunks in the build manifest.
 */
export function collectRoutes(tree: RouteTree): RouteInfo[] {
  const routes: RouteInfo[] = [];

  function walk(node: SegmentNode, chain: SegmentNode[]): void {
    const currentChain = [...chain, node];

    // Leaf with page
    if (node.page) {
      routes.push({
        path: node.urlPath || '/',
        segments: currentChain,
        entryFilePath: node.page.filePath,
      });
    }

    // Leaf with route.ts (API endpoint)
    if (node.route) {
      routes.push({
        path: node.urlPath || '/',
        segments: currentChain,
        entryFilePath: node.route.filePath,
      });
    }

    // Recurse into children
    for (const child of node.children) {
      walk(child, currentChain);
    }

    // Recurse into slots
    for (const slotNode of node.slots.values()) {
      walk(slotNode, currentChain);
    }
  }

  walk(tree.root, []);
  return routes;
}

// ─── Report formatting ────────────────────────────────────────────────────

/**
 * Build the formatted report lines for display.
 *
 * Produces a table with columns: icon + path, size, first-load JS.
 * Routes are sorted alphabetically. Shared chunk total is shown at the bottom.
 */
export function buildRouteReport(entries: RouteEntry[], sharedSize: number): string[] {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const lines: string[] = [];

  // Column headers
  const header = 'Route (app)';
  const sizeHeader = 'Size';
  const firstLoadHeader = 'First Load JS';

  // Compute column widths
  const pathColWidth = Math.max(
    header.length + 2,
    ...sorted.map((e) => e.path.length + 4) // +4 for "○ " prefix + padding
  );
  const sizeColWidth = Math.max(sizeHeader.length, 10);
  const firstLoadColWidth = Math.max(firstLoadHeader.length, 10);

  const totalWidth = pathColWidth + sizeColWidth + firstLoadColWidth + 4;

  // Header line
  lines.push(
    `${padRight(header, pathColWidth)}  ${padLeft(sizeHeader, sizeColWidth)}  ${padLeft(firstLoadHeader, firstLoadColWidth)}`
  );

  // Separator
  lines.push('─'.repeat(totalWidth));

  // Route entries
  for (const entry of sorted) {
    const icon = ROUTE_TYPE_ICONS[entry.type];
    const pathStr = `${icon} ${entry.path}`;
    const sizeStr = formatSize(entry.size);
    const firstLoadStr = formatSize(entry.firstLoadSize);

    lines.push(
      `${padRight(pathStr, pathColWidth)}  ${padLeft(sizeStr, sizeColWidth)}  ${padLeft(firstLoadStr, firstLoadColWidth)}`
    );
  }

  // Separator
  lines.push('─'.repeat(totalWidth));

  // Shared section
  lines.push(
    `${padRight('  Shared by all', pathColWidth)}  ${padLeft('', sizeColWidth)}  ${padLeft(formatSize(sharedSize), firstLoadColWidth)}`
  );

  // Blank line + legend
  lines.push('');
  lines.push(`○  (Static)   λ  (Dynamic)   ƒ  (Function)`);

  return lines;
}

function padRight(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - visualWidth(str)));
}

function padLeft(str: string, width: number): string {
  return ' '.repeat(Math.max(0, width - visualWidth(str))) + str;
}

/**
 * Approximate visual width of a string, accounting for common
 * multi-byte Unicode characters used as route type icons.
 */
function visualWidth(str: string): number {
  // These icons are all single-column characters in most terminals
  return str.length;
}

// ─── Chunk size collection ────────────────────────────────────────────────

interface OutputChunkLike {
  type: 'chunk' | 'asset';
  fileName: string;
  code?: string;
  source?: string | Uint8Array;
  modules?: Record<string, unknown>;
  facadeModuleId?: string | null;
}

/**
 * Collect byte sizes from a Vite output bundle.
 *
 * Returns a map of fileName → byte size for all chunks and CSS assets.
 */
export function collectChunkSizes(
  bundle: Record<string, OutputChunkLike>
): ChunkSizeMap {
  const sizes: ChunkSizeMap = new Map();

  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type === 'chunk' && item.code) {
      sizes.set(fileName, byteLength(item.code));
    } else if (item.type === 'asset' && fileName.endsWith('.css') && item.source != null) {
      const source = typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source);
      sizes.set(fileName, byteLength(source));
    }
  }

  return sizes;
}

function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Find the output chunk fileName for a given input file path.
 *
 * Walks the bundle looking for a chunk whose modules include the file,
 * or whose facadeModuleId matches.
 */
export function findChunkForFile(
  filePath: string,
  bundle: Record<string, OutputChunkLike>
): string | null {
  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type !== 'chunk') continue;

    // Check facadeModuleId (exact entry point)
    if (item.facadeModuleId === filePath) {
      return fileName;
    }

    // Check modules map (file included in this chunk)
    if (item.modules && filePath in item.modules) {
      return fileName;
    }
  }
  return null;
}

// ─── Vite Plugin ──────────────────────────────────────────────────────────

/**
 * Create the timber-build-report Vite plugin.
 *
 * Only active during production builds (not dev).
 *
 * Hooks:
 * - generateBundle: Collect chunk sizes from client build output
 * - closeBundle: Emit the formatted build report
 */
export function timberBuildReport(ctx: PluginContext): Plugin {
  let logger: Logger | null = null;
  let chunkSizes: ChunkSizeMap | null = null;
  let clientBundle: Record<string, OutputChunkLike> | null = null;
  let reported = false;

  return {
    name: 'timber-build-report',

    configResolved(config) {
      logger = config.logger;
    },

    generateBundle(_options, bundle) {
      // Skip in dev mode
      if (ctx.dev) return;

      // Only collect from the client environment — this is where browser-shipped
      // JS lives. Detect by checking if the environment name is 'client'.
      // Falls back to checking for browser entry chunks.
      const envName = this.environment?.name;
      if (envName && envName !== 'client') return;

      chunkSizes = collectChunkSizes(bundle as Record<string, OutputChunkLike>);
      clientBundle = { ...bundle } as Record<string, OutputChunkLike>;
    },

    closeBundle() {
      // Skip in dev mode or if already reported
      if (ctx.dev || reported) return;
      if (!ctx.routeTree || !chunkSizes || !clientBundle || !logger) return;
      reported = true;

      // Collect routes from the tree
      const routeInfos = collectRoutes(ctx.routeTree);

      // Compute total shared size (all chunks) and per-route sizes
      let totalClientSize = 0;
      for (const size of chunkSizes.values()) {
        totalClientSize += size;
      }

      // Track which chunks are route-specific
      const routeChunkFiles = new Set<string>();
      const entries: RouteEntry[] = [];

      for (const info of routeInfos) {
        let routeSize = 0;

        if (info.entryFilePath) {
          const chunkFile = findChunkForFile(info.entryFilePath, clientBundle);
          if (chunkFile) {
            routeSize = chunkSizes.get(chunkFile) ?? 0;
            routeChunkFiles.add(chunkFile);
          }
        }

        entries.push({
          path: info.path,
          type: classifyRoute(info.segments),
          size: routeSize,
          firstLoadSize: 0, // computed after shared size is known
        });
      }

      // Shared size = total - sum of route-specific chunks
      let routeSpecificTotal = 0;
      for (const file of routeChunkFiles) {
        routeSpecificTotal += chunkSizes.get(file) ?? 0;
      }
      const sharedSize = totalClientSize - routeSpecificTotal;

      // Compute first-load size for each route
      for (const entry of entries) {
        entry.firstLoadSize = entry.size + sharedSize;
      }

      // Format and log the report
      const lines = buildRouteReport(entries, sharedSize);

      logger.info('');
      for (const line of lines) {
        logger.info(line);
      }
      logger.info('');
    },
  };
}
