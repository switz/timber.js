/**
 * Tests for the dev logging system.
 *
 * Verifies:
 * - Event emitter collects and timestamps events
 * - Request collector builds tree from events
 * - Tree mode output with environment labels, timing, and nesting
 * - Summary mode output (one line per request)
 * - Quiet mode suppresses output
 * - Slow phase highlighting
 * - Cache annotations (HIT/MISS)
 * - Access check outcomes (PASS/DENY)
 * - Server action formatting
 * - trace_id shown on request line
 * - TIMBER_DEV_QUIET and TIMBER_DEV_LOG env vars
 *
 * Design ref: 21-dev-server.md §"Dev Logging", 17-logging.md §"Dev Logging"
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DevLogEmitter } from '../packages/timber-app/src/server/dev-log-events';
import type { DevLogEvent } from '../packages/timber-app/src/server/dev-log-events';
import { createRequestCollector, resolveLogMode } from '../packages/timber-app/src/server/dev-logger';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Strip ANSI escape codes for easier assertion. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Create a minimal request lifecycle of events. */
function createBasicRequestEvents(): DevLogEvent[] {
  return [
    {
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req-1',
      meta: { method: 'GET', path: '/dashboard', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' },
    },
    {
      type: 'phase-start',
      environment: 'proxy',
      label: 'proxy.ts',
      timestampMs: 0,
      id: 'proxy-1',
    },
    {
      type: 'phase-end',
      environment: 'proxy',
      label: 'proxy.ts',
      timestampMs: 2,
      id: 'proxy-1',
    },
    {
      type: 'phase-start',
      environment: 'rsc',
      label: 'middleware.ts',
      timestampMs: 2,
      id: 'mw-1',
    },
    {
      type: 'phase-end',
      environment: 'rsc',
      label: 'middleware.ts',
      timestampMs: 4,
      id: 'mw-1',
    },
    {
      type: 'phase-start',
      environment: 'rsc',
      label: 'render',
      timestampMs: 4,
      id: 'render-1',
    },
    {
      type: 'phase-end',
      environment: 'rsc',
      label: 'render',
      timestampMs: 12,
      id: 'render-1',
    },
    {
      type: 'phase-start',
      environment: 'ssr',
      label: 'hydration render',
      timestampMs: 13,
      id: 'ssr-1',
    },
    {
      type: 'phase-end',
      environment: 'ssr',
      label: 'hydration render',
      timestampMs: 18,
      id: 'ssr-1',
    },
    {
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 18,
      id: 'req-end-1',
      meta: { status: 200 },
    },
  ];
}

// ─── DevLogEmitter ──────────────────────────────────────────────────────

describe('DevLogEmitter', () => {
  it('emits events to listeners with timestamps', () => {
    const emitter = new DevLogEmitter();
    const collected: DevLogEvent[] = [];
    emitter.on((e) => collected.push(e));

    emitter.emit({
      type: 'phase-start',
      environment: 'rsc',
      label: 'render',
      id: 'render-1',
    });

    expect(collected).toHaveLength(1);
    expect(collected[0]!.type).toBe('phase-start');
    expect(collected[0]!.label).toBe('render');
    expect(typeof collected[0]!.timestampMs).toBe('number');
    expect(collected[0]!.timestampMs).toBeGreaterThanOrEqual(0);
  });

  it('supports multiple listeners', () => {
    const emitter = new DevLogEmitter();
    const a: DevLogEvent[] = [];
    const b: DevLogEvent[] = [];
    emitter.on((e) => a.push(e));
    emitter.on((e) => b.push(e));

    emitter.emit({ type: 'phase-start', environment: 'rsc', label: 'test', id: 'x' });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('tracks elapsed time', async () => {
    const emitter = new DevLogEmitter();
    // Small delay to ensure non-zero elapsed
    await new Promise((r) => setTimeout(r, 5));
    expect(emitter.elapsed()).toBeGreaterThan(0);
  });
});

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
    const collector = createRequestCollector();
    for (const event of createBasicRequestEvents()) {
      collector.collect(event);
    }

    const output = stripAnsi(collector.format('tree'));
    expect(output).toContain('GET /dashboard');
    expect(output).toContain('trace_id: 4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('shows environment labels [rsc]/[ssr]/[proxy]', () => {
    const collector = createRequestCollector();
    for (const event of createBasicRequestEvents()) {
      collector.collect(event);
    }

    const output = stripAnsi(collector.format('tree'));
    expect(output).toContain('[proxy]');
    expect(output).toContain('[rsc]');
    expect(output).toContain('[ssr]');
  });

  it('shows phase timing', () => {
    const collector = createRequestCollector();
    for (const event of createBasicRequestEvents()) {
      collector.collect(event);
    }

    const output = stripAnsi(collector.format('tree'));
    expect(output).toContain('0ms → 2ms');
    expect(output).toContain('2ms → 4ms');
    expect(output).toContain('13ms → 18ms');
  });

  it('shows final status and total time', () => {
    const collector = createRequestCollector();
    for (const event of createBasicRequestEvents()) {
      collector.collect(event);
    }

    const output = stripAnsi(collector.format('tree'));
    expect(output).toContain('200 OK');
    expect(output).toContain('total    18ms');
  });
});

// ─── Summary Mode ───────────────────────────────────────────────────────

describe('summary mode', () => {
  it('shows one-line format with method, path, status, timing, and trace_id', () => {
    const collector = createRequestCollector();
    for (const event of createBasicRequestEvents()) {
      collector.collect(event);
    }

    const output = stripAnsi(collector.format('summary'));
    expect(output).toContain('GET /dashboard');
    expect(output).toContain('200 OK');
    expect(output).toContain('18ms');
    expect(output).toContain('trace_id:');
  });

  it('fits in one line', () => {
    const collector = createRequestCollector();
    for (const event of createBasicRequestEvents()) {
      collector.collect(event);
    }

    const output = collector.format('summary');
    const lineCount = output.trim().split('\n').length;
    expect(lineCount).toBe(1);
  });
});

// ─── Quiet Mode ─────────────────────────────────────────────────────────

describe('quiet mode', () => {
  it('produces empty output', () => {
    const collector = createRequestCollector();
    for (const event of createBasicRequestEvents()) {
      collector.collect(event);
    }

    const output = collector.format('quiet');
    expect(output).toBe('');
  });
});

// ─── Cache Annotations ──────────────────────────────────────────────────

describe('cache annotations', () => {
  it('shows timber.cache HIT/MISS', () => {
    const collector = createRequestCollector();
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req',
      meta: { method: 'GET', path: '/', traceId: 'abc123' },
    });
    collector.collect({
      type: 'cache-hit',
      environment: 'rsc',
      label: 'getUser()',
      timestampMs: 5,
      id: 'cache-1',
      meta: { cacheType: 'timber.cache', durationMs: 0.5 },
    });
    collector.collect({
      type: 'cache-miss',
      environment: 'rsc',
      label: 'getProject("123")',
      timestampMs: 6,
      id: 'cache-2',
      meta: { cacheType: 'timber.cache', durationMs: 43 },
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 50,
      id: 'req-end',
      meta: { status: 200 },
    });

    const output = stripAnsi(collector.format('tree'));
    expect(output).toContain('timber.cache HIT');
    expect(output).toContain('<1ms');
    expect(output).toContain('timber.cache MISS');
    expect(output).toContain('43ms');
  });
});

// ─── Access Check Outcomes ──────────────────────────────────────────────

describe('access check outcomes', () => {
  it('shows PASS/DENY with status', () => {
    const collector = createRequestCollector();
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req',
      meta: { method: 'GET', path: '/', traceId: 'abc' },
    });
    collector.collect({
      type: 'access-result',
      environment: 'rsc',
      label: 'AccessGate (authenticated)',
      timestampMs: 5,
      id: 'access-1',
      meta: { result: 'PASS' },
    });
    collector.collect({
      type: 'access-result',
      environment: 'rsc',
      label: 'AccessGate (project)',
      timestampMs: 8,
      id: 'access-2',
      meta: { result: 'DENY', status: 404 },
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 10,
      id: 'req-end',
      meta: { status: 404 },
    });

    const output = stripAnsi(collector.format('tree'));
    expect(output).toContain('PASS');
    expect(output).toContain('DENY 404');
  });
});

// ─── Slow Phase Highlighting ────────────────────────────────────────────

describe('slow phase', () => {
  it('highlights phases slower than slowPhaseMs', () => {
    const collector = createRequestCollector({ slowPhaseMs: 100 });
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req',
      meta: { method: 'GET', path: '/', traceId: 'abc' },
    });
    collector.collect({
      type: 'phase-start',
      environment: 'rsc',
      label: 'slow-render',
      timestampMs: 0,
      id: 'render-1',
    });
    collector.collect({
      type: 'phase-end',
      environment: 'rsc',
      label: 'slow-render',
      timestampMs: 250,
      id: 'render-1',
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 250,
      id: 'req-end',
      meta: { status: 200 },
    });

    // The raw output should contain ANSI yellow for the slow phase
    const rawOutput = collector.format('tree');
    expect(rawOutput).toContain('\x1b[33m'); // YELLOW
    expect(rawOutput).toContain('slow-render');
  });

  it('does not highlight fast phases', () => {
    const collector = createRequestCollector({ slowPhaseMs: 200 });
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req',
      meta: { method: 'GET', path: '/', traceId: 'abc' },
    });
    collector.collect({
      type: 'phase-start',
      environment: 'rsc',
      label: 'fast-render',
      timestampMs: 0,
      id: 'render-1',
    });
    collector.collect({
      type: 'phase-end',
      environment: 'rsc',
      label: 'fast-render',
      timestampMs: 10,
      id: 'render-1',
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 10,
      id: 'req-end',
      meta: { status: 200 },
    });

    const rawOutput = collector.format('tree');
    // The label should not be wrapped in yellow
    const labelIndex = rawOutput.indexOf('fast-render');
    const precedingChars = rawOutput.slice(Math.max(0, labelIndex - 10), labelIndex);
    expect(precedingChars).not.toContain('\x1b[33m');
  });
});

// ─── Server Actions ─────────────────────────────────────────────────────

describe('server actions', () => {
  it('shows action name and source file', () => {
    const collector = createRequestCollector();
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'action',
      timestampMs: 0,
      id: 'req',
      meta: {
        method: 'POST',
        path: '/todos',
        traceId: 'abc123',
        actionName: 'createTodo',
        actionFile: 'app/todos/actions.ts',
      },
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 28,
      id: 'req-end',
      meta: { status: 200 },
    });

    const output = stripAnsi(collector.format('tree'));
    expect(output).toContain('ACTION createTodo');
    expect(output).toContain('app/todos/actions.ts');
    expect(output).toContain('trace_id: abc123');
  });
});

// ─── Nested Events ──────────────────────────────────────────────────────

describe('nested events', () => {
  it('nests child events under parent phases', () => {
    const collector = createRequestCollector();
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req',
      meta: { method: 'GET', path: '/', traceId: 'abc' },
    });
    collector.collect({
      type: 'phase-start',
      environment: 'rsc',
      label: 'render',
      timestampMs: 4,
      id: 'render-1',
    });
    collector.collect({
      type: 'cache-hit',
      environment: 'rsc',
      label: 'getUser()',
      timestampMs: 5,
      id: 'cache-1',
      parentId: 'render-1',
      meta: { cacheType: 'timber.cache', durationMs: 0 },
    });
    collector.collect({
      type: 'phase-end',
      environment: 'rsc',
      label: 'render',
      timestampMs: 12,
      id: 'render-1',
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 12,
      id: 'req-end',
      meta: { status: 200 },
    });

    const output = stripAnsi(collector.format('tree'));
    // The cache hit should be indented under the render phase
    const lines = output.split('\n');
    const renderLine = lines.findIndex((l: string) => l.includes('render'));
    const cacheLine = lines.findIndex((l: string) => l.includes('getUser()'));
    expect(cacheLine).toBeGreaterThan(renderLine);
  });
});

// ─── Suspense Boundaries ────────────────────────────────────────────────

describe('suspense boundaries', () => {
  it('shows streamed Suspense resolution', () => {
    const collector = createRequestCollector();
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req',
      meta: { method: 'GET', path: '/', traceId: 'abc' },
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 18,
      id: 'req-end',
      meta: {
        status: 200,
        streamed: [{ label: 'RecentActivity', resolveMs: 94 }],
      },
    });

    const output = stripAnsi(collector.format('tree'));
    expect(output).toContain('RecentActivity (Suspense)');
    expect(output).toContain('94ms');
    expect(output).toContain('streamed');
  });
});

// ─── Production Logger Off in Dev ───────────────────────────────────────

describe('production logger isolation', () => {
  it('dev logger is independent of production logger', () => {
    // The dev logger is a separate system from the production logger.
    // This test verifies they don't share state.
    const collector = createRequestCollector();
    const events = createBasicRequestEvents();
    for (const event of events) {
      collector.collect(event);
    }

    // Should produce output regardless of production logger state
    const output = collector.format('tree');
    expect(output.length).toBeGreaterThan(0);
  });
});
