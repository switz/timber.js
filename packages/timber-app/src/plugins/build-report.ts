/**
 * timber-build-report — Post-build route summary table.
 *
 * After a production build, logs a per-route table showing:
 * - Route type (○ static, λ dynamic, ƒ function)
 * - Route-specific client JS size
 * - First-load JS size (gzip) — route-specific + shared chunks
 *
 * Only active during production builds. Sizes are computed from the
 * already-generated Vite client bundle — no extra analysis passes.
 *
 * Design docs: 18-build-system.md §"Build Pipeline", 07-routing.md
 * Task: TIM-287
 */

import { gzipSync } from 'node:zlib';
import type { Plugin, Logger } from 'vite';
import type { PluginContext } from '../index.js';
import type { SegmentNode, RouteTree } from '../routing/types.js';

// ─── Public types ─────────────────────────────────────────────────────────

export type RouteType = 'static' | 'dynamic' | 'function';

export interface RouteEntry {
  path: string;
  type: RouteType;
  /** Route-specific client JS size in bytes (raw). */
  size: number;
  /** Total first-load JS in bytes (gzip): route-specific + shared. */
  firstLoadSize: number;
}

// ─── Route classification ─────────────────────────────────────────────────

const ROUTE_TYPE_ICONS: Record<RouteType, string> = {
  static: '○',
  dynamic: 'λ',
  function: 'ƒ',
};

/**
 * Classify a route by its segment chain and output mode.
 *
 * In server mode (default), all pages are dynamic (rendered per-request).
 * In static mode, only pages with dynamic/catch-all segments are dynamic.
 * API routes (route.ts) are always classified as function.
 */
export function classifyRoute(
  segments: SegmentNode[],
  outputMode: 'server' | 'static' = 'server'
): RouteType {
  const leaf = segments[segments.length - 1];
  if (leaf?.route) return 'function';
  if (outputMode === 'server') return 'dynamic';

  const isDynamic = segments.some(
    (s) =>
      s.segmentType === 'dynamic' ||
      s.segmentType === 'catch-all' ||
      s.segmentType === 'optional-catch-all'
  );
  return isDynamic ? 'dynamic' : 'static';
}

// ─── Size helpers ─────────────────────────────────────────────────────────

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function green(text: string): string {
  return `\x1b[92m${text}\x1b[39m`; // bright/light green (ANSI 92)
}

// ─── Route tree collection ────────────────────────────────────────────────

interface RouteInfo {
  path: string;
  segments: SegmentNode[];
  entryFilePath: string | null;
}

/** Walk the route tree and collect all leaf routes (pages + API endpoints). */
export function collectRoutes(tree: RouteTree): RouteInfo[] {
  const routes: RouteInfo[] = [];

  function walk(node: SegmentNode, chain: SegmentNode[]): void {
    const currentChain = [...chain, node];
    const path = node.urlPath || '/';

    if (node.page) {
      routes.push({ path, segments: currentChain, entryFilePath: node.page.filePath });
    }
    if (node.route) {
      routes.push({ path, segments: currentChain, entryFilePath: node.route.filePath });
    }

    for (const child of node.children) walk(child, currentChain);
    for (const slot of node.slots.values()) walk(slot, currentChain);
  }

  walk(tree.root, []);
  return routes;
}

// ─── Report formatting ────────────────────────────────────────────────────

/** Produce formatted report lines for the Vite logger. */
export function buildRouteReport(entries: RouteEntry[], sharedSize: number): string[] {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  const header = 'Route (app)';
  const sizeHeader = 'Size';
  const firstLoadHeader = 'First Load JS';

  const pathW = Math.max(header.length + 2, ...sorted.map((e) => e.path.length + 6));
  const sizeW = Math.max(sizeHeader.length, 14);
  const flW = Math.max(firstLoadHeader.length, 10);
  const totalW = pathW + sizeW + flW + 4;
  const sep = '─'.repeat(totalW);

  const lines: string[] = [];

  // Header
  lines.push(
    `${pad(header, pathW)}  ${pad(sizeHeader, sizeW, 'left')}  ${pad(firstLoadHeader, flW, 'left')}`
  );
  lines.push(sep);

  // Routes
  for (const entry of sorted) {
    const icon = ROUTE_TYPE_ICONS[entry.type];
    const pathStr = `  ${icon} ${entry.path}`;
    const sizeStr = entry.size === 0 ? green('zero unique JS') : formatSize(entry.size);
    const flStr = formatSize(entry.firstLoadSize);
    lines.push(
      `${pad(pathStr, pathW)}  ${pad(sizeStr, sizeW, 'left')}  ${pad(flStr, flW, 'left')}`
    );
  }

  // Footer
  lines.push(sep);
  lines.push(
    `${pad('  Shared by all', pathW)}  ${pad('', sizeW, 'left')}  ${pad(formatSize(sharedSize), flW, 'left')}`
  );
  lines.push('');
  lines.push('○  (Static)   λ  (Dynamic)   ƒ  (Function)');

  return lines;
}

function pad(str: string, width: number, align: 'left' | 'right' = 'right'): string {
  const gap = Math.max(0, width - stripAnsi(str).length);
  return align === 'left' ? ' '.repeat(gap) + str : str + ' '.repeat(gap);
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[\d+m/g, '');
}

// ─── Bundle analysis ──────────────────────────────────────────────────────

interface ChunkSize {
  raw: number;
  gzip: number;
}

interface OutputChunkLike {
  type: 'chunk' | 'asset';
  fileName: string;
  code?: string;
  source?: string | Uint8Array;
  modules?: Record<string, unknown>;
  facadeModuleId?: string | null;
}

/** Measure raw + gzip sizes for all JS chunks and CSS assets in a bundle. */
export function collectChunkSizes(bundle: Record<string, OutputChunkLike>): Map<string, ChunkSize> {
  const sizes = new Map<string, ChunkSize>();
  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type === 'chunk' && item.code) {
      sizes.set(fileName, measure(item.code));
    } else if (item.type === 'asset' && fileName.endsWith('.css') && item.source != null) {
      const src =
        typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source);
      sizes.set(fileName, measure(src));
    }
  }
  return sizes;
}

function measure(content: string): ChunkSize {
  const buf = new TextEncoder().encode(content);
  return { raw: buf.length, gzip: gzipSync(buf).length };
}

/** Find the output chunk that contains a given input file. */
export function findChunkForFile(
  filePath: string,
  bundle: Record<string, OutputChunkLike>
): string | null {
  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type !== 'chunk') continue;
    if (item.facadeModuleId === filePath) return fileName;
    if (item.modules && filePath in item.modules) return fileName;
  }
  return null;
}

// ─── Build route entries from collected data ──────────────────────────────

function buildEntries(
  routeTree: RouteTree,
  chunkSizes: Map<string, ChunkSize>,
  bundle: Record<string, OutputChunkLike>,
  outputMode: 'server' | 'static'
): { entries: RouteEntry[]; sharedGzip: number } {
  const routeInfos = collectRoutes(routeTree);

  // Total gzip across all client chunks
  let totalGzip = 0;
  for (const s of chunkSizes.values()) totalGzip += s.gzip;

  // Per-route sizes and track route-specific chunks
  const routeChunkFiles = new Set<string>();
  const entries: RouteEntry[] = [];

  for (const info of routeInfos) {
    let raw = 0;
    let gzip = 0;

    if (info.entryFilePath) {
      const chunk = findChunkForFile(info.entryFilePath, bundle);
      if (chunk) {
        const s = chunkSizes.get(chunk);
        if (s) {
          raw = s.raw;
          gzip = s.gzip;
        }
        routeChunkFiles.add(chunk);
      }
    }

    entries.push({
      path: info.path,
      type: classifyRoute(info.segments, outputMode),
      size: raw,
      firstLoadSize: gzip, // route-specific gzip — shared added below
    });
  }

  // Shared = total gzip minus route-specific gzip
  let routeGzip = 0;
  for (const f of routeChunkFiles) routeGzip += chunkSizes.get(f)?.gzip ?? 0;
  const sharedGzip = totalGzip - routeGzip;

  for (const e of entries) e.firstLoadSize += sharedGzip;

  return { entries, sharedGzip };
}

// ─── Vite plugin ──────────────────────────────────────────────────────────

/**
 * Suppress RSC/SSR per-chunk build log lines.
 *
 * Vite logs each output chunk via config.logger.info(). We wrap that method
 * to filter lines matching dist/rsc/ or dist/ssr/ paths. The regex is
 * non-anchored because Vite prepends ANSI color codes.
 */
function suppressNonClientLogs(config: { command: string; logger: Logger }): void {
  if (config.command !== 'build') return;
  const orig = config.logger.info.bind(config.logger);
  config.logger.info = (msg: string, opts?: { timestamp?: boolean }) => {
    if (typeof msg === 'string' && /dist\/(rsc|ssr)\//.test(msg)) return;
    orig(msg, opts);
  };
}

export function timberBuildReport(ctx: PluginContext): Plugin {
  let logger: Logger | null = null;
  let chunkSizes: Map<string, ChunkSize> | null = null;
  let clientBundle: Record<string, OutputChunkLike> | null = null;
  let reported = false;
  let deferReport = false;
  const buildStart = performance.now();

  return {
    name: 'timber-build-report',

    config(_cfg, { command }) {
      if (command !== 'build') return;
      return {
        environments: {
          rsc: { build: { reportCompressedSize: false } },
          ssr: { build: { reportCompressedSize: false } },
        },
      };
    },

    configResolved(config) {
      logger = config.logger;
      suppressNonClientLogs(config);
    },

    generateBundle(_options, bundle) {
      if (ctx.dev) return;
      if (this.environment?.name && this.environment.name !== 'client') return;

      chunkSizes = collectChunkSizes(bundle as Record<string, OutputChunkLike>);
      clientBundle = { ...bundle } as Record<string, OutputChunkLike>;
      deferReport = true; // skip client's closeBundle; emit after SSR's
    },

    closeBundle() {
      if (ctx.dev || reported) return;

      // The client build's closeBundle fires before SSR starts.
      // Defer one cycle so the report appears after all builds complete.
      if (deferReport) {
        deferReport = false;
        return;
      }
      if (!ctx.routeTree || !chunkSizes || !clientBundle || !logger) return;

      reported = true;
      const outputMode = ctx.config.output ?? 'server';
      const clientJsDisabled = ctx.clientJavascript.disabled;
      const { entries, sharedGzip } = clientJsDisabled
        ? {
            entries: collectRoutes(ctx.routeTree).map((info) => ({
              path: info.path,
              type: classifyRoute(info.segments, outputMode),
              size: 0,
              firstLoadSize: 0,
            })),
            sharedGzip: 0,
          }
        : buildEntries(ctx.routeTree, chunkSizes, clientBundle, outputMode);
      const elapsed = ((performance.now() - buildStart) / 1000).toFixed(2);
      const lines = buildRouteReport(entries, sharedGzip);

      logger.info('');
      for (const line of lines) logger.info(line);
      logger.info('');
      logger.info(
        `✓ built ${entries.length} routes for all three environments (rsc, ssr, client) in ${elapsed}s`
      );
      logger.info('');
    },
  };
}
