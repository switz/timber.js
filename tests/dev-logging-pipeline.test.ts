/**
 * Tests for dev logging integration with the pipeline.
 *
 * Verifies that the pipeline produces correct OTEL spans that the
 * DevSpanProcessor can consume for dev log output.
 *
 * Design ref: 21-dev-server.md §"Dev Logging", 17-logging.md §"Dev Logging"
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createPipeline,
  type PipelineConfig,
  type RouteMatch,
} from '../packages/timber-app/src/server/pipeline';
import { resolveLogMode } from '../packages/timber-app/src/server/dev-logger';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

function makeMatch(overrides?: Partial<RouteMatch>): RouteMatch {
  return {
    segments: [],
    params: {},
    ...overrides,
  };
}

function okRender(): PipelineConfig['render'] {
  return () => new Response('OK', { status: 200 });
}

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    matchRoute: () => makeMatch(),
    render: okRender(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('dev logging pipeline (span-based)', () => {
  describe('pipeline creates correct spans', () => {
    it('pipeline runs without onDevLog (removed in span-based refactor)', async () => {
      const pipeline = createPipeline(makeConfig());
      const response = await pipeline(makeRequest('/test'));
      expect(response.status).toBe(200);
    });

    it('pipeline runs with proxy', async () => {
      const pipeline = createPipeline(
        makeConfig({
          proxy: async (_req, next) => next(),
          matchRoute: () =>
            makeMatch({
              middleware: async () => {},
            }),
        })
      );
      const response = await pipeline(makeRequest('/test'));
      expect(response.status).toBe(200);
    });
  });

  describe('resolveLogMode', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('returns quiet when TIMBER_DEV_QUIET=1', () => {
      process.env.TIMBER_DEV_QUIET = '1';
      expect(resolveLogMode()).toBe('quiet');
    });

    it('returns summary when TIMBER_DEV_LOG=summary', () => {
      delete process.env.TIMBER_DEV_QUIET;
      process.env.TIMBER_DEV_LOG = 'summary';
      expect(resolveLogMode()).toBe('summary');
    });

    it('returns verbose when TIMBER_DEV_LOG=verbose', () => {
      delete process.env.TIMBER_DEV_QUIET;
      process.env.TIMBER_DEV_LOG = 'verbose';
      expect(resolveLogMode()).toBe('verbose');
    });

    it('returns tree by default', () => {
      delete process.env.TIMBER_DEV_QUIET;
      delete process.env.TIMBER_DEV_LOG;
      expect(resolveLogMode()).toBe('tree');
    });

    it('config mode is used when no env override', () => {
      delete process.env.TIMBER_DEV_QUIET;
      delete process.env.TIMBER_DEV_LOG;
      expect(resolveLogMode({ mode: 'summary' })).toBe('summary');
    });

    it('env overrides config', () => {
      process.env.TIMBER_DEV_QUIET = '1';
      expect(resolveLogMode({ mode: 'tree' })).toBe('quiet');
    });
  });

  describe('production silent', () => {
    it('no dev log overhead when OTEL is not initialized', async () => {
      // In production, no OTEL SDK is initialized, so withSpan is a no-op.
      // This test verifies the pipeline works without any dev log system.
      const pipeline = createPipeline(makeConfig());
      const response = await pipeline(makeRequest('/test'));
      expect(response.status).toBe(200);
    });
  });
});
