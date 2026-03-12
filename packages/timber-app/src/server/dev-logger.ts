/**
 * Dev logger — structured console output for every request in dev mode.
 *
 * Formats OTEL span trees into indented tree output for stderr. Spans are
 * the single source of truth — no separate event system needed.
 *
 * Supports five modes:
 * - tree (default) — indented tree per request
 * - verbose — detailed tree showing every component render
 * - summary — one line per request
 * - json — chronological NDJSON dump of all spans
 * - quiet — no output
 *
 * Design doc: 21-dev-server.md §"Dev Logging", 17-logging.md §"Dev Logging"
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

// ─── Configuration ──────────────────────────────────────────────────────────

export type DevLogMode = 'tree' | 'verbose' | 'summary' | 'json' | 'quiet';

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
const MAGENTA = '\x1b[35m';

/**
 * Color an HTTP method for dev log output.
 * GET is dimmed (it's the default/boring case), others get distinct colors.
 */
function colorMethod(method: string): string {
  switch (method) {
    case 'GET':
      return `${DIM}${method}${RESET}`;
    case 'POST':
      return `${GREEN}${BOLD}${method}${RESET}`;
    case 'PUT':
      return `${YELLOW}${BOLD}${method}${RESET}`;
    case 'DELETE':
      return `${RED}${BOLD}${method}${RESET}`;
    case 'PATCH':
      return `${CYAN}${BOLD}${method}${RESET}`;
    case 'HEAD':
      return `${DIM}${method}${RESET}`;
    case 'OPTIONS':
      return `${MAGENTA}${BOLD}${method}${RESET}`;
    default:
      return `${BOLD}${method}${RESET}`;
  }
}

// ─── HrTime Helpers ─────────────────────────────────────────────────────────

type HrTime = [number, number];

function hrTimeToMs(hr: HrTime): number {
  return hr[0] * 1000 + hr[1] / 1_000_000;
}

function relativeMs(time: HrTime, rootStart: HrTime): number {
  return hrTimeToMs(time) - hrTimeToMs(rootStart);
}

// ─── Span → Tree Mapping ────────────────────────────────────────────────────

/** Map span names to display labels and environment tags. */
function spanLabel(span: ReadableSpan): { label: string; env: string } {
  const attrs = span.attributes;
  switch (span.name) {
    case 'timber.proxy':
      return { label: 'proxy.ts', env: 'proxy' };
    case 'timber.middleware':
      return { label: 'middleware.ts', env: 'rsc' };
    case 'timber.render':
      return { label: 'render', env: 'rsc' };
    case 'timber.access': {
      const seg = attrs['timber.segment'] ?? 'segment';
      return { label: `AccessGate (${seg})`, env: 'rsc' };
    }
    case 'timber.ssr':
      return { label: 'hydration render', env: 'ssr' };
    case 'timber.action': {
      const name = attrs['timber.action_name'] ?? 'action';
      return { label: String(name), env: 'rsc' };
    }
    case 'timber.metadata':
      return { label: 'generateMetadata()', env: 'rsc' };
    case 'timber.layout': {
      const seg = attrs['timber.segment'] ?? '/';
      return { label: `layout ${seg}`, env: 'rsc' };
    }
    case 'timber.page': {
      const route = attrs['timber.route'] ?? '/';
      return { label: `page ${route}`, env: 'rsc' };
    }
    default:
      return { label: span.name, env: 'rsc' };
  }
}

// ─── Tree Node ──────────────────────────────────────────────────────────────

interface SpanTreeNode {
  span: ReadableSpan;
  children: SpanTreeNode[];
}

/**
 * Build a tree from a flat list of spans using parentSpanId relationships.
 */
function buildSpanTree(spans: ReadableSpan[]): {
  root: ReadableSpan | null;
  children: SpanTreeNode[];
} {
  const root = spans.find((s) => s.name === 'http.server.request') ?? null;
  if (!root) return { root: null, children: [] };

  // Index spans by spanId for parent lookup
  const bySpanId = new Map<string, SpanTreeNode>();
  for (const span of spans) {
    if (span === root) continue;
    bySpanId.set(span.spanContext().spanId, { span, children: [] });
  }

  // Build parent-child relationships
  const rootChildren: SpanTreeNode[] = [];
  for (const node of bySpanId.values()) {
    const parentId = node.span.parentSpanContext?.spanId;
    if (parentId === root.spanContext().spanId) {
      rootChildren.push(node);
    } else if (parentId && bySpanId.has(parentId)) {
      bySpanId.get(parentId)!.children.push(node);
    } else {
      // Orphan — attach to root
      rootChildren.push(node);
    }
  }

  // Sort children by start time
  const sortByStart = (a: SpanTreeNode, b: SpanTreeNode) =>
    hrTimeToMs(a.span.startTime) - hrTimeToMs(b.span.startTime);

  rootChildren.sort(sortByStart);
  for (const node of bySpanId.values()) {
    node.children.sort(sortByStart);
  }

  return { root, children: rootChildren };
}

// ─── Log Mode Resolution ────────────────────────────────────────────────────

/**
 * Resolve the effective log mode from environment variables and config.
 * Environment variables override config file values per 21-dev-server.md.
 */
export function resolveLogMode(config?: DevLoggerConfig): DevLogMode {
  if (process.env.TIMBER_DEV_QUIET === '1') return 'quiet';
  const envMode = process.env.TIMBER_DEV_LOG;
  if (envMode === 'summary' || envMode === 'tree' || envMode === 'verbose' || envMode === 'json')
    return envMode;
  return config?.mode ?? 'tree';
}

// ─── Formatters ─────────────────────────────────────────────────────────────

/**
 * Format spans as a full indented tree string for stderr.
 */
export function formatSpanTree(spans: ReadableSpan[], config?: DevLoggerConfig): string {
  const slowPhaseMs = config?.slowPhaseMs ?? 200;
  const { root, children } = buildSpanTree(spans);
  if (!root) return '';

  const rootStart = root.startTime;
  const lines: string[] = [];

  // Request header line
  const method = String(root.attributes['http.request.method'] ?? 'GET');
  const path = String(root.attributes['url.path'] ?? '/');
  const traceId = root.spanContext().traceId;
  const actionName = root.attributes['timber.action_name'] as string | undefined;

  const dimTrace = `${DIM}trace_id: ${traceId}${RESET}`;
  if (actionName) {
    const actionFile = root.attributes['timber.action_file'] as string | undefined;
    lines.push(
      `${BOLD}ACTION ${actionName}${actionFile ? ` (${actionFile})` : ''}${RESET}  ${dimTrace}`
    );
  } else {
    lines.push(`${colorMethod(method)} ${BOLD}${path}${RESET}  ${dimTrace}`);
  }

  // Render child span nodes
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    formatSpanNode(children[i]!, lines, '', isLast, slowPhaseMs, rootStart);
  }

  // Result line
  const statusCode = root.attributes['http.response.status_code'] as number | undefined;
  const status = statusCode ?? (root.status.code === 2 ? 500 : 200);
  const totalMs = Math.round(hrTimeToMs(root.duration));
  const statusColor = status < 400 ? GREEN : status < 500 ? YELLOW : RED;
  const statusText = `${status} ${httpStatusText(status)}`;

  // Surface deny() signal info for 500s caused by deny-inside-suspense
  const denyInfo = root.attributes['timber.deny_status'] as number | undefined;
  const denyNote = denyInfo
    ? `${DIM}  (caused by deny(${denyInfo}) inside Suspense — status already committed)${RESET}`
    : '';

  lines.push(
    `${statusColor}└─ ✓ ${statusText}${RESET}${DIM}                              total    ${totalMs}ms${RESET}${denyNote}`
  );

  return lines.join('\n') + '\n';
}

/**
 * Format a single span tree node with children, timing, and annotations.
 */
function formatSpanNode(
  node: SpanTreeNode,
  lines: string[],
  prefix: string,
  isLast: boolean,
  slowPhaseMs: number,
  rootStart: HrTime
): void {
  const connector = isLast ? '└─' : '├─';
  const childPrefix = prefix + (isLast ? '   ' : '│  ');
  const { label, env } = spanLabel(node.span);
  const startMs = Math.round(relativeMs(node.span.startTime, rootStart));
  const endMs = Math.round(relativeMs(node.span.endTime, rootStart));
  const durationMs = endMs - startMs;
  const isSlow = durationMs > slowPhaseMs;

  // Access results from span attributes
  const accessResult = node.span.attributes['timber.result'] as string | undefined;

  let timing = `${startMs}ms → ${endMs}ms`;
  if (accessResult) {
    const accessStatus = node.span.attributes['timber.deny_status'] as number | undefined;
    const denyFile = node.span.attributes['timber.deny_file'] as string | undefined;
    timing += `  → ${accessResult.toUpperCase()}${accessStatus ? ` ${accessStatus}` : ''}`;
    if (denyFile) {
      timing += `  (${denyFile})`;
    }
  }

  const slowHighlight = isSlow ? YELLOW : '';
  const slowReset = isSlow ? RESET : '';
  const envTag = `${CYAN}[${env}]${RESET}`;
  const line = `${prefix}${connector} ${envTag} ${slowHighlight}${label}${slowReset}  ${DIM}${timing}${RESET}`;
  lines.push(line);

  // Span events (cache hits/misses) as child annotations
  for (const event of node.span.events) {
    if (event.name === 'timber.cache.hit' || event.name === 'timber.cache.miss') {
      const key = String(event.attributes?.['key'] ?? '');
      const hitMiss = event.name === 'timber.cache.hit' ? 'HIT' : 'MISS';
      const durMs = event.attributes?.['duration_ms'] as number | undefined;
      const durStr = durMs !== undefined ? `  ${durMs < 1 ? '<1' : Math.round(durMs)}ms` : '';
      const stale = event.attributes?.['stale'] ? ' (stale)' : '';
      lines.push(
        `${childPrefix}${DIM}└── ${key}  timber.cache ${hitMiss}${durStr}${stale}${RESET}`
      );
    }
  }

  // Render children
  for (let i = 0; i < node.children.length; i++) {
    const childIsLast = i === node.children.length - 1;
    formatSpanNode(node.children[i]!, lines, childPrefix, childIsLast, slowPhaseMs, rootStart);
  }
}

/**
 * Format spans as a one-line summary.
 */
export function formatSpanSummary(spans: ReadableSpan[], _config?: DevLoggerConfig): string {
  const root = spans.find((s) => s.name === 'http.server.request');
  if (!root) return '';

  const method = String(root.attributes['http.request.method'] ?? 'GET');
  const path = String(root.attributes['url.path'] ?? '/');
  const statusCode = root.attributes['http.response.status_code'] as number | undefined;
  const status = statusCode ?? (root.status.code === 2 ? 500 : 200);
  const totalMs = Math.round(hrTimeToMs(root.duration));
  const traceId = root.spanContext().traceId;
  const traceIdShort = traceId.slice(0, 8);

  const statusColor = status < 400 ? GREEN : status < 500 ? YELLOW : RED;
  return `${colorMethod(method)} ${path} → ${statusColor}${status} ${httpStatusText(status)}${RESET}  ${totalMs}ms  ${DIM}trace_id: ${traceIdShort}...${RESET}\n`;
}

/**
 * Format spans as chronological NDJSON for json mode.
 *
 * Each span is one JSON line, ordered by start time. Useful for piping
 * to jq or feeding into external trace analysis tools.
 */
export function formatJson(spans: ReadableSpan[]): string {
  const root = spans.find((s) => s.name === 'http.server.request');
  const rootStart = root?.startTime ?? ([0, 0] as HrTime);

  // Sort by start time
  const sorted = [...spans].sort((a, b) => hrTimeToMs(a.startTime) - hrTimeToMs(b.startTime));

  const lines: string[] = [];
  for (const span of sorted) {
    const entry = {
      name: span.name,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: span.parentSpanContext?.spanId,
      startMs: Math.round(relativeMs(span.startTime, rootStart)),
      endMs: Math.round(relativeMs(span.endTime, rootStart)),
      durationMs: Math.round(hrTimeToMs(span.duration)),
      attributes: span.attributes,
      events: span.events.map((e) => ({
        name: e.name,
        timeMs: Math.round(relativeMs(e.time as HrTime, rootStart)),
        attributes: e.attributes,
      })),
      status: span.status,
    };
    lines.push(JSON.stringify(entry));
  }

  return lines.join('\n') + '\n';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
