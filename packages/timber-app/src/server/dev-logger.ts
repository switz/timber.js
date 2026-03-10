/**
 * Dev logger — structured console output for every request in dev mode.
 *
 * Collects events from a DevLogEmitter, builds a tree structure, and
 * formats it as an indented tree to stderr.
 *
 * Supports three modes:
 * - tree (default) — full indented tree per request
 * - summary — one line per request
 * - quiet — no output
 *
 * Design doc: 21-dev-server.md §"Dev Logging", 17-logging.md §"Dev Logging"
 */

import type { DevLogEvent, DevLogEnvironment } from './dev-log-events.js';

// ─── Configuration ──────────────────────────────────────────────────────────

export type DevLogMode = 'tree' | 'summary' | 'quiet';

export interface DevLoggerConfig {
  /** Logging mode. Default: 'tree'. */
  mode?: DevLogMode;
  /** Threshold in ms to highlight slow phases. Default: 200. */
  slowPhaseMs?: number;
}

// ─── ANSI Codes ─────────────────────────────────────────────────────────────

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

// ─── Tree Node ──────────────────────────────────────────────────────────────

interface TreeNode {
  event: DevLogEvent;
  /** End timestamp for phase-start events (set when phase-end arrives). */
  endMs?: number;
  children: TreeNode[];
}

// ─── Dev Logger ─────────────────────────────────────────────────────────────

/**
 * Resolve the effective log mode from environment variables and config.
 * Environment variables override config file values per 21-dev-server.md.
 */
export function resolveLogMode(config?: DevLoggerConfig): DevLogMode {
  if (process.env.TIMBER_DEV_QUIET === '1') return 'quiet';
  const envMode = process.env.TIMBER_DEV_LOG;
  if (envMode === 'summary' || envMode === 'tree') return envMode;
  return config?.mode ?? 'tree';
}

/**
 * Collect dev log events for a single request and produce formatted output.
 *
 * Usage:
 *   const collector = createRequestCollector(config);
 *   emitter.on(collector.collect);
 *   // ... request completes ...
 *   const output = collector.format();
 *   process.stderr.write(output);
 */
export function createRequestCollector(config?: DevLoggerConfig) {
  const events: DevLogEvent[] = [];
  const slowPhaseMs = config?.slowPhaseMs ?? 200;

  function collect(event: DevLogEvent): void {
    events.push(event);
  }

  /**
   * Build the tree structure from collected events.
   */
  function buildTree(): {
    roots: TreeNode[];
    requestInfo: DevLogEvent | null;
    requestEnd: DevLogEvent | null;
  } {
    const nodeById = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];
    let requestInfo: DevLogEvent | null = null;
    let requestEnd: DevLogEvent | null = null;

    for (const event of events) {
      if (event.type === 'request-start') {
        requestInfo = event;
        continue;
      }
      if (event.type === 'request-end') {
        requestEnd = event;
        continue;
      }
      if (event.type === 'phase-end') {
        // Find the matching phase-start and set its end time
        const startNode = nodeById.get(event.id);
        if (startNode) {
          startNode.endMs = event.timestampMs;
        }
        continue;
      }

      // All other events become tree nodes
      const node: TreeNode = { event, children: [] };
      nodeById.set(event.id, node);

      if (event.parentId) {
        const parent = nodeById.get(event.parentId);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    return { roots, requestInfo, requestEnd };
  }

  /**
   * Format the collected events as a tree string for stderr.
   */
  function formatTree(): string {
    const { roots, requestInfo, requestEnd } = buildTree();
    const lines: string[] = [];

    // Request header line
    const method = (requestInfo?.meta?.method as string) ?? 'GET';
    const path = (requestInfo?.meta?.path as string) ?? '/';
    const traceIdVal = (requestInfo?.meta?.traceId as string) ?? '';
    const actionName = requestInfo?.meta?.actionName as string | undefined;

    if (actionName) {
      const actionFile = (requestInfo?.meta?.actionFile as string) ?? '';
      lines.push(
        `${BOLD}ACTION ${actionName}${actionFile ? ` (${actionFile})` : ''}  trace_id: ${traceIdVal}${RESET}`
      );
    } else {
      lines.push(`${BOLD}${method} ${path}  trace_id: ${traceIdVal}${RESET}`);
    }

    // Render tree nodes
    for (let i = 0; i < roots.length; i++) {
      const isLast = i === roots.length - 1;
      formatNode(roots[i]!, lines, '', isLast, slowPhaseMs);
    }

    // Result line
    if (requestEnd) {
      const status = (requestEnd.meta?.status as number) ?? 200;
      const totalMs = Math.round(requestEnd.timestampMs);
      const statusColor = status < 400 ? GREEN : status < 500 ? YELLOW : RED;
      const statusText = `${status} ${httpStatusText(status)}`;
      lines.push(
        `${statusColor}└─ ✓ ${statusText}${RESET}${DIM}                              total    ${totalMs}ms${RESET}`
      );

      // Streamed Suspense boundaries after flush
      const streamedNodes =
        (requestEnd.meta?.streamed as Array<{ label: string; resolveMs: number }>) ?? [];
      for (const streamed of streamedNodes) {
        lines.push(
          `${DIM}   └─ [rsc]  ${streamed.label} (Suspense)              ·  → ${streamed.resolveMs}ms  (streamed)${RESET}`
        );
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Format the collected events as a one-line summary.
   */
  function formatSummary(): string {
    const { requestInfo, requestEnd } = buildTree();

    const method = (requestInfo?.meta?.method as string) ?? 'GET';
    const path = (requestInfo?.meta?.path as string) ?? '/';
    const status = (requestEnd?.meta?.status as number) ?? 200;
    const totalMs = requestEnd ? Math.round(requestEnd.timestampMs) : 0;
    const traceIdVal = (requestInfo?.meta?.traceId as string) ?? '';
    const traceIdShort = traceIdVal.slice(0, 8);

    const statusColor = status < 400 ? GREEN : status < 500 ? YELLOW : RED;
    return `${method} ${path} → ${statusColor}${status} ${httpStatusText(status)}${RESET}  ${totalMs}ms  trace_id: ${traceIdShort}...\n`;
  }

  /**
   * Format output based on the resolved log mode.
   */
  function format(mode: DevLogMode): string {
    if (mode === 'quiet') return '';
    if (mode === 'summary') return formatSummary();
    return formatTree();
  }

  return { collect, format };
}

// ─── Tree Formatting Helpers ────────────────────────────────────────────────

function formatNode(
  node: TreeNode,
  lines: string[],
  prefix: string,
  isLast: boolean,
  slowPhaseMs: number
): void {
  const connector = isLast ? '└─' : '├─';
  const childPrefix = prefix + (isLast ? '   ' : '│  ');

  const env = formatEnv(node.event.environment);
  const label = node.event.label;
  const startMs = Math.round(node.event.timestampMs);

  let timing = '';
  let isSlow = false;

  if (node.endMs !== undefined) {
    const endMs = Math.round(node.endMs);
    const durationMs = endMs - startMs;
    isSlow = durationMs > slowPhaseMs;
    timing = `${startMs}ms → ${endMs}ms`;
  } else if (node.event.type === 'cache-hit' || node.event.type === 'cache-miss') {
    const cacheType = (node.event.meta?.cacheType as string) ?? 'timber.cache';
    const hitMiss = node.event.type === 'cache-hit' ? 'HIT' : 'MISS';
    const durationMs = node.event.meta?.durationMs as number | undefined;
    const durationStr =
      durationMs !== undefined ? `  ${durationMs < 1 ? '<1' : Math.round(durationMs)}ms` : '';
    timing = `${cacheType} ${hitMiss}${durationStr}`;
  } else if (node.event.type === 'access-result') {
    const result = (node.event.meta?.result as string) ?? 'PASS';
    const status = node.event.meta?.status as number | undefined;
    timing = status ? `${result} ${status}` : result;
  } else if (node.event.type === 'suspense-resolve') {
    const resolveMs = Math.round((node.event.meta?.resolveMs as number) ?? node.event.timestampMs);
    timing = `·  → ${resolveMs}ms  (streamed)`;
  }

  // Build the line
  const slowHighlight = isSlow ? YELLOW : '';
  const slowReset = isSlow ? RESET : '';
  const timingPad = timing ? `  ${DIM}${timing}${RESET}` : '';
  const line = `${prefix}${connector} ${env} ${slowHighlight}${label}${slowReset}${timingPad}`;
  lines.push(line);

  // Render children
  for (let i = 0; i < node.children.length; i++) {
    const childIsLast = i === node.children.length - 1;
    formatNode(node.children[i]!, lines, childPrefix, childIsLast, slowPhaseMs);
  }
}

function formatEnv(env: DevLogEnvironment): string {
  return `${CYAN}[${env}]${RESET}`;
}

function httpStatusText(status: number): string {
  const texts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    413: 'Payload Too Large',
    500: 'Internal Server Error',
  };
  return texts[status] ?? String(status);
}
