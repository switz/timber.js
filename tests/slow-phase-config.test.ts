/**
 * Tests for dev.slowPhaseMs config option.
 *
 * Verifies that the slowPhaseMs threshold:
 * - Is accepted in the TimberUserConfig.dev object
 * - Defaults to 200ms when not specified
 * - Is passed through to the runtime config module
 * - Flows through to createRequestCollector for slow phase highlighting
 *
 * Design ref: 17-logging.md §"Slow Phase Highlighting"
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timberEntries } from '../packages/timber-app/src/plugins/entries.js';
import type { PluginContext, TimberUserConfig } from '../packages/timber-app/src/index.js';
import { createRequestCollector } from '../packages/timber-app/src/server/dev-logger.js';

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
  };
}

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

// ─── createRequestCollector respects slowPhaseMs ────────────────────────

describe('createRequestCollector uses slowPhaseMs', () => {
  it('highlights phases exceeding custom threshold', () => {
    // 50ms threshold — a 100ms phase should be highlighted
    const collector = createRequestCollector({ slowPhaseMs: 50 });
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req',
      meta: { method: 'GET', path: '/', traceId: 'abc123' },
    });
    collector.collect({
      type: 'phase-start',
      environment: 'rsc',
      label: 'render',
      timestampMs: 0,
      id: 'render-1',
    });
    collector.collect({
      type: 'phase-end',
      environment: 'rsc',
      label: 'render',
      timestampMs: 100,
      id: 'render-1',
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 100,
      id: 'req-end',
      meta: { status: 200 },
    });

    const rawOutput = collector.format('tree');
    // Should contain ANSI yellow for the slow phase
    expect(rawOutput).toContain('\x1b[33m');
  });

  it('does not highlight phases under custom threshold', () => {
    // 500ms threshold — a 100ms phase should NOT be highlighted
    const collector = createRequestCollector({ slowPhaseMs: 500 });
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req',
      meta: { method: 'GET', path: '/', traceId: 'abc123' },
    });
    collector.collect({
      type: 'phase-start',
      environment: 'rsc',
      label: 'render',
      timestampMs: 0,
      id: 'render-1',
    });
    collector.collect({
      type: 'phase-end',
      environment: 'rsc',
      label: 'render',
      timestampMs: 100,
      id: 'render-1',
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 100,
      id: 'req-end',
      meta: { status: 200 },
    });

    const rawOutput = collector.format('tree');
    // Should NOT contain ANSI yellow — phase is under threshold
    expect(rawOutput).not.toContain('\x1b[33m');
  });

  it('uses 200ms default when slowPhaseMs not specified', () => {
    // No slowPhaseMs — default is 200ms. A 150ms phase should NOT be highlighted.
    const collector = createRequestCollector({});
    collector.collect({
      type: 'request-start',
      environment: 'rsc',
      label: 'request',
      timestampMs: 0,
      id: 'req',
      meta: { method: 'GET', path: '/', traceId: 'abc123' },
    });
    collector.collect({
      type: 'phase-start',
      environment: 'rsc',
      label: 'render',
      timestampMs: 0,
      id: 'render-1',
    });
    collector.collect({
      type: 'phase-end',
      environment: 'rsc',
      label: 'render',
      timestampMs: 150,
      id: 'render-1',
    });
    collector.collect({
      type: 'request-end',
      environment: 'rsc',
      label: 'done',
      timestampMs: 150,
      id: 'req-end',
      meta: { status: 200 },
    });

    const rawOutput = collector.format('tree');
    // Should NOT contain ANSI yellow — 150ms is under 200ms default
    expect(rawOutput).not.toContain('\x1b[33m');
  });
});
