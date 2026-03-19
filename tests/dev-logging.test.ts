/**
 * Tests for the span-based dev logging system.
 *
 * Verifies:
 * - Span tree formatting with environment labels, timing, and nesting
 * - Summary mode output (one line per request)
 * - Verbose mode (NDJSON span dump)
 * - Quiet mode suppresses output
 * - Slow phase highlighting
 * - Cache annotations (HIT/MISS) from span events
 * - Access check outcomes (PASS/DENY) from span attributes
 * - Server action formatting
 * - trace_id shown on request line
 * - TIMBER_DEV_QUIET, TIMBER_DEV_LOG env vars, verbose and json modes
 *
 * Design ref: 21-dev-server.md §"Dev Logging", 17-logging.md §"Dev Logging"
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  formatSpanTree,
  formatSpanSummary,
  formatJson,
  resolveLogMode,
} from '../packages/timber-app/src/server/dev-logger';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Strip ANSI escape codes for easier assertion. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

type HrTime = [number, number];

function msToHrTime(ms: number): HrTime {
  return [Math.floor(ms / 1000), (ms % 1000) * 1_000_000];
}

/** Create a mock ReadableSpan. */
function mockSpan(opts: {
  name: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  startMs: number;
  endMs: number;
  attributes?: Record<string, string | number | boolean>;
  events?: Array<{
    name: string;
    timeMs: number;
    attributes?: Record<string, string | number | boolean>;
  }>;
  statusCode?: number;
}): ReadableSpan {
  const traceId = opts.traceId ?? '4bf92f3577b34da6a3ce929d0e0e4736';
  const spanId = opts.spanId ?? Math.random().toString(16).slice(2, 18).padEnd(16, '0');
  const parentSpanContext = opts.parentSpanId
    ? { traceId, spanId: opts.parentSpanId, traceFlags: 1 }
    : undefined;
  return {
    name: opts.name,
    spanContext: () => ({
      traceId,
      spanId,
      traceFlags: 1,
    }),
    parentSpanContext,
    startTime: msToHrTime(opts.startMs),
    endTime: msToHrTime(opts.endMs),
    duration: msToHrTime(opts.endMs - opts.startMs),
    attributes: opts.attributes ?? {},
    events: (opts.events ?? []).map((e) => ({
      name: e.name,
      time: msToHrTime(e.timeMs),
      attributes: e.attributes,
    })),
    status: { code: opts.statusCode ?? 0 },
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

/** Create a basic set of spans for a typical request. */
function createBasicRequestSpans(): ReadableSpan[] {
  return [
    mockSpan({
      name: 'timber.proxy',
      spanId: 'bbbb000000000001',
      parentSpanId: ROOT_SPAN_ID,
      startMs: 0,
      endMs: 2,
    }),
    mockSpan({
      name: 'timber.middleware',
      spanId: 'bbbb000000000002',
      parentSpanId: ROOT_SPAN_ID,
      startMs: 2,
      endMs: 4,
    }),
    mockSpan({
      name: 'timber.render',
      spanId: 'bbbb000000000003',
      parentSpanId: ROOT_SPAN_ID,
      startMs: 4,
      endMs: 12,
      attributes: { 'http.route': '/dashboard' },
    }),
    mockSpan({
      name: 'timber.ssr',
      spanId: 'bbbb000000000004',
      parentSpanId: ROOT_SPAN_ID,
      startMs: 13,
      endMs: 18,
      attributes: { 'timber.environment': 'ssr' },
    }),
    // Root span ends last
    mockSpan({
      name: 'http.server.request',
      spanId: ROOT_SPAN_ID,
      startMs: 0,
      endMs: 18,
      attributes: {
        'http.request.method': 'GET',
        'url.path': '/dashboard',
        'http.response.status_code': 200,
      },
    }),
  ];
}

// ─── Log Mode Resolution ────────────────────────────────────────────────

describe('resolveLogMode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env.TIMBER_DEV_QUIET = originalEnv.TIMBER_DEV_QUIET;
    process.env.TIMBER_DEV_LOG = originalEnv.TIMBER_DEV_LOG;
  });

  it('defaults to tree mode', () => {
    delete process.env.TIMBER_DEV_QUIET;
    delete process.env.TIMBER_DEV_LOG;
    expect(resolveLogMode()).toBe('tree');
  });

  it('quiet mode', () => {
    process.env.TIMBER_DEV_QUIET = '1';
    expect(resolveLogMode()).toBe('quiet');
  });

  it('summary mode', () => {
    delete process.env.TIMBER_DEV_QUIET;
    process.env.TIMBER_DEV_LOG = 'summary';
    expect(resolveLogMode()).toBe('summary');
  });

  it('tree mode', () => {
    delete process.env.TIMBER_DEV_QUIET;
    process.env.TIMBER_DEV_LOG = 'tree';
    expect(resolveLogMode()).toBe('tree');
  });

  it('verbose mode', () => {
    delete process.env.TIMBER_DEV_QUIET;
    process.env.TIMBER_DEV_LOG = 'verbose';
    expect(resolveLogMode()).toBe('verbose');
  });

  it('json mode', () => {
    delete process.env.TIMBER_DEV_QUIET;
    process.env.TIMBER_DEV_LOG = 'json';
    expect(resolveLogMode()).toBe('json');
  });

  it('TIMBER_DEV_QUIET takes precedence over TIMBER_DEV_LOG', () => {
    process.env.TIMBER_DEV_QUIET = '1';
    process.env.TIMBER_DEV_LOG = 'tree';
    expect(resolveLogMode()).toBe('quiet');
  });

  it('config mode is used when env vars are not set', () => {
    delete process.env.TIMBER_DEV_QUIET;
    delete process.env.TIMBER_DEV_LOG;
    expect(resolveLogMode({ mode: 'summary' })).toBe('summary');
  });

  it('env var overrides config', () => {
    delete process.env.TIMBER_DEV_QUIET;
    process.env.TIMBER_DEV_LOG = 'summary';
    expect(resolveLogMode({ mode: 'tree' })).toBe('summary');
  });
});

// ─── Tree Mode Output ───────────────────────────────────────────────────

describe('tree mode', () => {
  it('shows request method, path, and trace_id', () => {
    const spans = createBasicRequestSpans();
    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('GET /dashboard');
    expect(output).toContain('trace_id: 4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('shows environment labels [rsc]/[ssr]/[proxy]', () => {
    const spans = createBasicRequestSpans();
    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('[proxy]');
    expect(output).toContain('[rsc]');
    expect(output).toContain('[ssr]');
  });

  it('shows phase timing', () => {
    const spans = createBasicRequestSpans();
    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('0ms → 2ms');
    expect(output).toContain('2ms → 4ms');
    expect(output).toContain('13ms → 18ms');
  });

  it('shows final status and total time', () => {
    const spans = createBasicRequestSpans();
    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('200 OK');
    expect(output).toContain('total    18ms');
  });

  it('returns empty string when no root span', () => {
    const spans = [mockSpan({ name: 'timber.proxy', startMs: 0, endMs: 2 })];
    expect(formatSpanTree(spans)).toBe('');
  });
});

// ─── Summary Mode ───────────────────────────────────────────────────────

describe('summary mode', () => {
  it('shows one-line format with method, path, status, timing, and trace_id', () => {
    const spans = createBasicRequestSpans();
    const output = stripAnsi(formatSpanSummary(spans));
    expect(output).toContain('GET /dashboard');
    expect(output).toContain('200 OK');
    expect(output).toContain('18ms');
    expect(output).toContain('trace_id:');
  });

  it('fits in one line', () => {
    const spans = createBasicRequestSpans();
    const output = formatSpanSummary(spans);
    const lineCount = output.trim().split('\n').length;
    expect(lineCount).toBe(1);
  });
});

// ─── Verbose Mode ───────────────────────────────────────────────────────

describe('json mode', () => {
  it('produces NDJSON output with one span per line', () => {
    const spans = createBasicRequestSpans();
    const output = formatJson(spans);
    const lines = output.trim().split('\n');
    expect(lines.length).toBe(spans.length);
    // Each line should be valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty('name');
      expect(parsed).toHaveProperty('traceId');
      expect(parsed).toHaveProperty('durationMs');
    }
  });

  it('sorts spans by start time', () => {
    const spans = createBasicRequestSpans();
    const output = formatJson(spans);
    const lines = output
      .trim()
      .split('\n')
      .map((l: string) => JSON.parse(l));
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startMs).toBeGreaterThanOrEqual(lines[i - 1].startMs);
    }
  });

  it('includes span events in output', () => {
    const spans = [
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 4,
        endMs: 12,
        events: [
          { name: 'timber.cache.hit', timeMs: 5, attributes: { key: 'getUser()', duration_ms: 0 } },
        ],
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 12,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];
    const output = formatJson(spans);
    expect(output).toContain('timber.cache.hit');
    expect(output).toContain('getUser()');
  });
});

// ─── Cache Annotations ──────────────────────────────────────────────────

describe('cache annotations', () => {
  it('shows timber.cache HIT/MISS from span events', () => {
    const spans = [
      mockSpan({
        name: 'timber.page',
        spanId: 'bbbb000000000005',
        parentSpanId: 'bbbb000000000003',
        startMs: 8,
        endMs: 12,
        attributes: { 'timber.route': '/' },
        events: [
          { name: 'timber.cache.hit', timeMs: 9, attributes: { key: 'getUser()', duration_ms: 0 } },
          {
            name: 'timber.cache.miss',
            timeMs: 10,
            attributes: { key: 'getProject("123")', duration_ms: 43 },
          },
        ],
      }),
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 4,
        endMs: 12,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 12,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];
    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('timber.cache HIT');
    expect(output).toContain('<1ms');
    expect(output).toContain('timber.cache MISS');
    expect(output).toContain('43ms');
  });
});

// ─── Access Check Outcomes ──────────────────────────────────────────────

describe('access check outcomes', () => {
  it('shows PASS/DENY with status from span attributes', () => {
    const spans = [
      mockSpan({
        name: 'timber.access',
        spanId: 'bbbb000000000006',
        parentSpanId: 'bbbb000000000003',
        startMs: 4,
        endMs: 5,
        attributes: { 'timber.segment': 'authenticated', 'timber.result': 'pass' },
      }),
      mockSpan({
        name: 'timber.access',
        spanId: 'bbbb000000000007',
        parentSpanId: 'bbbb000000000003',
        startMs: 7,
        endMs: 8,
        attributes: {
          'timber.segment': 'project',
          'timber.result': 'deny',
          'timber.deny_status': 404,
        },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 4,
        endMs: 12,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 12,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 404,
        },
      }),
    ];
    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('PASS');
    expect(output).toContain('DENY 404');
  });

  it('shows deny source file when timber.deny_file is set', () => {
    const spans: ReadableSpan[] = [
      mockSpan({
        name: 'timber.access',
        spanId: 'bbbb000000000005',
        parentSpanId: 'bbbb000000000003',
        startMs: 2,
        endMs: 3,
        attributes: {
          'timber.segment': 'admin',
          'timber.result': 'deny',
          'timber.deny_status': 403,
          'timber.deny_file': 'app/admin/access.ts',
        },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 1,
        endMs: 5,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 5,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/admin',
          'http.response.status_code': 403,
        },
      }),
    ];
    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('DENY 403');
    expect(output).toContain('(app/admin/access.ts)');
  });
});

// ─── Slow Phase Highlighting ────────────────────────────────────────────

describe('slow phase', () => {
  it('highlights phases slower than slowPhaseMs', () => {
    const spans = [
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 250,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 250,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];
    const rawOutput = formatSpanTree(spans, { slowPhaseMs: 100 });
    expect(rawOutput).toContain('\x1b[33m'); // YELLOW
    expect(rawOutput).toContain('render');
  });

  it('does not highlight fast phases', () => {
    const spans = [
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 10,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 10,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];
    const rawOutput = formatSpanTree(spans, { slowPhaseMs: 200 });
    const labelIndex = rawOutput.indexOf('render');
    const precedingChars = rawOutput.slice(Math.max(0, labelIndex - 10), labelIndex);
    expect(precedingChars).not.toContain('\x1b[33m');
  });
});

// ─── Server Actions ─────────────────────────────────────────────────────

describe('server actions', () => {
  it('shows action name and source file', () => {
    const spans = [
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 28,
        attributes: {
          'http.request.method': 'POST',
          'url.path': '/todos',
          'http.response.status_code': 200,
          'timber.action_name': 'createTodo',
          'timber.action_file': 'app/todos/actions.ts',
        },
      }),
    ];
    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('ACTION createTodo');
    expect(output).toContain('app/todos/actions.ts');
    expect(output).toContain('trace_id: 4bf92f3577b34da6a3ce929d0e0e4736');
  });
});

// ─── Nested Spans ───────────────────────────────────────────────────────

describe('nested spans', () => {
  it('nests child spans under parent spans', () => {
    const spans = [
      mockSpan({
        name: 'timber.access',
        spanId: 'bbbb000000000006',
        parentSpanId: 'bbbb000000000003',
        startMs: 5,
        endMs: 6,
        attributes: { 'timber.segment': 'auth', 'timber.result': 'pass' },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: 'bbbb000000000003',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 4,
        endMs: 12,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 12,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];
    const output = stripAnsi(formatSpanTree(spans));
    const lines = output.split('\n');
    const renderLine = lines.findIndex((l: string) => l.includes('render'));
    const accessLine = lines.findIndex((l: string) => l.includes('AccessGate'));
    expect(accessLine).toBeGreaterThan(renderLine);
  });
});

// ─── Layout Nesting (re-parenting) ──────────────────────────────────────

describe('layout nesting', () => {
  it('re-parents flat layout/page spans into nested hierarchy', () => {
    // Simulates what OTEL produces: all layout/page spans are direct children
    // of timber.render because React concurrent rendering breaks parent chains.
    const RENDER_ID = 'bbbb000000000003';
    const spans = [
      mockSpan({
        name: 'timber.layout',
        spanId: 'cccc000000000001',
        parentSpanId: RENDER_ID,
        startMs: 2,
        endMs: 3,
        attributes: { 'timber.segment': '/' },
      }),
      mockSpan({
        name: 'timber.layout',
        spanId: 'cccc000000000002',
        parentSpanId: RENDER_ID,
        startMs: 5,
        endMs: 6,
        attributes: { 'timber.segment': '/docs' },
      }),
      mockSpan({
        name: 'timber.page',
        spanId: 'cccc000000000003',
        parentSpanId: RENDER_ID,
        startMs: 7,
        endMs: 8,
        attributes: { 'timber.route': '/docs/[slug]' },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: RENDER_ID,
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 10,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 10,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/docs/intro',
          'http.response.status_code': 200,
        },
      }),
    ];

    const output = stripAnsi(formatSpanTree(spans));
    const lines = output.split('\n').filter((l: string) => l.trim().length > 0);

    // layout / should be child of render
    const rootLayoutLine = lines.findIndex(
      (l: string) => l.includes('layout /') && !l.includes('/docs')
    );
    // layout /docs should be nested deeper than layout /
    const docsLayoutLine = lines.findIndex((l: string) => l.includes('layout /docs'));
    // page should be nested deepest
    const pageLine = lines.findIndex((l: string) => l.includes('page /docs/[slug]'));

    expect(rootLayoutLine).toBeGreaterThan(-1);
    expect(docsLayoutLine).toBeGreaterThan(rootLayoutLine);
    expect(pageLine).toBeGreaterThan(docsLayoutLine);

    // Verify nesting via indentation — each level should be more indented
    const indent = (line: string) => line.length - line.trimStart().length;
    expect(indent(lines[docsLayoutLine]!)).toBeGreaterThan(indent(lines[rootLayoutLine]!));
    expect(indent(lines[pageLine]!)).toBeGreaterThan(indent(lines[docsLayoutLine]!));
  });

  it('preserves non-layout children at render level', () => {
    const RENDER_ID = 'bbbb000000000003';
    const spans = [
      mockSpan({
        name: 'timber.access',
        spanId: 'cccc000000000000',
        parentSpanId: RENDER_ID,
        startMs: 1,
        endMs: 2,
        attributes: { 'timber.segment': 'auth', 'timber.result': 'pass' },
      }),
      mockSpan({
        name: 'timber.layout',
        spanId: 'cccc000000000001',
        parentSpanId: RENDER_ID,
        startMs: 2,
        endMs: 3,
        attributes: { 'timber.segment': '/' },
      }),
      mockSpan({
        name: 'timber.page',
        spanId: 'cccc000000000002',
        parentSpanId: RENDER_ID,
        startMs: 4,
        endMs: 5,
        attributes: { 'timber.route': '/' },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: RENDER_ID,
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 6,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 6,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];

    const output = stripAnsi(formatSpanTree(spans));
    // AccessGate should still be a direct child of render, not nested under layout
    expect(output).toContain('AccessGate');
    const lines = output.split('\n').filter((l: string) => l.trim().length > 0);
    const accessLine = lines.findIndex((l: string) => l.includes('AccessGate'));
    const layoutLine = lines.findIndex((l: string) => l.includes('layout /'));

    const indent = (line: string) => line.length - line.trimStart().length;
    // Access and layout should be at the same indent level (both children of render)
    expect(indent(lines[accessLine]!)).toBe(indent(lines[layoutLine]!));
  });
});

// ─── Route Group Labels ─────────────────────────────────────────────────

describe('route group labels', () => {
  it('shows group directory name instead of duplicate urlPath', () => {
    const RENDER_ID = 'bbbb000000000003';
    const spans = [
      mockSpan({
        name: 'timber.layout',
        spanId: 'cccc000000000001',
        parentSpanId: RENDER_ID,
        startMs: 2,
        endMs: 3,
        attributes: { 'timber.segment': '/' },
      }),
      mockSpan({
        name: 'timber.layout',
        spanId: 'cccc000000000002',
        parentSpanId: RENDER_ID,
        startMs: 5,
        endMs: 6,
        // Route group label includes directory name
        attributes: { 'timber.segment': '/(pre-release)' },
      }),
      mockSpan({
        name: 'timber.page',
        spanId: 'cccc000000000003',
        parentSpanId: RENDER_ID,
        startMs: 7,
        endMs: 8,
        attributes: { 'timber.route': '/docs' },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: RENDER_ID,
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 10,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 10,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/docs',
          'http.response.status_code': 200,
        },
      }),
    ];

    const output = stripAnsi(formatSpanTree(spans));
    // Should show "layout /" AND "layout /(pre-release)" — distinguishable
    expect(output).toContain('layout /');
    expect(output).toContain('layout /(pre-release)');
  });
});

// ─── Production Logger Independence ─────────────────────────────────────

describe('production logger isolation', () => {
  it('span formatter is independent of production logger', () => {
    const spans = createBasicRequestSpans();
    const output = formatSpanTree(spans);
    expect(output.length).toBeGreaterThan(0);
  });
});
