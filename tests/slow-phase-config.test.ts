/**
 * Tests for dev.slowPhaseMs config option.
 *
 * Verifies that the slowPhaseMs threshold:
 * - Is accepted in the TimberUserConfig.dev object
 * - Defaults to 200ms when not specified
 * - Is passed through to the runtime config module
 * - Flows through to formatSpanTree for slow phase highlighting
 *
 * Design ref: 17-logging.md §"Slow Phase Highlighting"
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timberEntries } from '../packages/timber-app/src/plugins/entries.js';
import type { PluginContext, TimberUserConfig } from '../packages/timber-app/src/index.js';
import { createNoopTimer } from '../packages/timber-app/src/utils/startup-timer';
import { formatSpanTree } from '../packages/timber-app/src/server/dev-logger.js';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

function createPluginContext(config?: TimberUserConfig): PluginContext {
  return {
    config: { output: 'server', ...config },
    routeTree: null,
    appDir: resolve(PROJECT_ROOT, 'app'),
    root: PROJECT_ROOT,
    dev: true,
    buildManifest: null,
    timer: createNoopTimer(),
  };
}

type HrTime = [number, number];
function msToHrTime(ms: number): HrTime {
  return [Math.floor(ms / 1000), (ms % 1000) * 1_000_000];
}

function mockSpan(opts: {
  name: string;
  spanId?: string;
  parentSpanId?: string;
  startMs: number;
  endMs: number;
  attributes?: Record<string, string | number | boolean>;
}): ReadableSpan {
  const spanId = opts.spanId ?? Math.random().toString(16).slice(2, 18).padEnd(16, '0');
  const parentSpanContext = opts.parentSpanId
    ? { traceId: 'abc123'.padEnd(32, '0'), spanId: opts.parentSpanId, traceFlags: 1 }
    : undefined;
  return {
    name: opts.name,
    spanContext: () => ({
      traceId: 'abc123'.padEnd(32, '0'),
      spanId,
      traceFlags: 1,
    }),
    parentSpanContext,
    startTime: msToHrTime(opts.startMs),
    endTime: msToHrTime(opts.endMs),
    duration: msToHrTime(opts.endMs - opts.startMs),
    attributes: opts.attributes ?? {},
    events: [],
    status: { code: 0 },
    resource: { attributes: {} },
    instrumentationScope: { name: 'timber.js' },
    ended: true,
    kind: 0,
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

const ROOT_SPAN_ID = 'aaaa000000000001';

// ─── Config option ──────────────────────────────────────────────────────

describe('dev.slowPhaseMs config option', () => {
  it('config option', () => {
    // TypeScript accepts dev.slowPhaseMs in TimberUserConfig
    const config: TimberUserConfig = {
      dev: { slowPhaseMs: 500 },
    };
    const ctx = createPluginContext(config);
    expect(ctx.config.dev?.slowPhaseMs).toBe(500);
  });

  it('default 200ms', () => {
    const plugin = timberEntries(createPluginContext());
    const load = plugin.load as (id: string) => string | null;
    const result = load.call({}, '\0virtual:timber-config');
    expect(result).not.toBeNull();
    expect(result).toContain('"slowPhaseMs": 200');
  });

  it('custom threshold', () => {
    const plugin = timberEntries(createPluginContext({ dev: { slowPhaseMs: 500 } }));
    const load = plugin.load as (id: string) => string | null;
    const result = load.call({}, '\0virtual:timber-config');
    expect(result).not.toBeNull();
    expect(result).toContain('"slowPhaseMs": 500');
  });
});

// ─── formatSpanTree respects slowPhaseMs ────────────────────────────────

describe('formatSpanTree uses slowPhaseMs', () => {
  it('highlights phases exceeding custom threshold', () => {
    const spans = [
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 100,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 100,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];
    // 50ms threshold — a 100ms phase should be highlighted
    const rawOutput = formatSpanTree(spans, { slowPhaseMs: 50 });
    expect(rawOutput).toContain('\x1b[33m');
  });

  it('does not highlight phases under custom threshold', () => {
    const spans = [
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 100,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 100,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];
    // 500ms threshold — a 100ms phase should NOT be highlighted
    const rawOutput = formatSpanTree(spans, { slowPhaseMs: 500 });
    expect(rawOutput).not.toContain('\x1b[33m');
  });

  it('uses 200ms default when slowPhaseMs not specified', () => {
    const spans = [
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 150,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 150,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];
    // No slowPhaseMs — default is 200ms. A 150ms phase should NOT be highlighted.
    const rawOutput = formatSpanTree(spans, {});
    expect(rawOutput).not.toContain('\x1b[33m');
  });
});
