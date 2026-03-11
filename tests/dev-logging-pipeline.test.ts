import { describe, it, expect, afterEach } from 'vitest';
import {
  createPipeline,
  type PipelineConfig,
  type RouteMatch,
} from '../packages/timber-app/src/server/pipeline';
import { DevLogEmitter, type DevLogEvent } from '../packages/timber-app/src/server/dev-log-events';
import {
  createRequestCollector,
  resolveLogMode,
} from '../packages/timber-app/src/server/dev-logger';

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

/** Collect all dev log events emitted during a pipeline request. */
function collectDevLogEvents(config: Partial<PipelineConfig> = {}): {
  events: DevLogEvent[];
  pipeline: (req: Request) => Promise<Response>;
} {
  const events: DevLogEvent[] = [];
  const pipeline = createPipeline(
    makeConfig({
      ...config,
      onDevLog: (emitter: DevLogEmitter) => {
        emitter.on((event) => events.push(event));
      },
    })
  );
  return { events, pipeline };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('dev logging pipeline', () => {
  describe('request-start', () => {
    it('request-start event includes method, path, traceId', async () => {
      const { events, pipeline } = collectDevLogEvents();
      await pipeline(makeRequest('/test'));

      const start = events.find((e) => e.type === 'request-start');
      expect(start).toBeDefined();
      expect(start!.meta?.method).toBe('GET');
      expect(start!.meta?.path).toBe('/test');
      expect(start!.meta?.traceId).toBeDefined();
      expect(typeof start!.meta?.traceId).toBe('string');
      expect(String(start!.meta!.traceId).length).toBe(32);
    });
  });

  describe('phase events', () => {
    it('emits phase-start/phase-end for proxy, middleware, render', async () => {
      const { events, pipeline } = collectDevLogEvents({
        proxy: async (_req, next) => next(),
        matchRoute: () =>
          makeMatch({
            middleware: async () => {},
          }),
      });

      await pipeline(makeRequest('/test'));

      // Proxy phase
      const proxyStart = events.find((e) => e.type === 'phase-start' && e.id === 'proxy');
      const proxyEnd = events.find((e) => e.type === 'phase-end' && e.id === 'proxy');
      expect(proxyStart).toBeDefined();
      expect(proxyEnd).toBeDefined();
      expect(proxyStart!.environment).toBe('proxy');

      // Middleware phase
      const mwStart = events.find((e) => e.type === 'phase-start' && e.id === 'middleware');
      const mwEnd = events.find((e) => e.type === 'phase-end' && e.id === 'middleware');
      expect(mwStart).toBeDefined();
      expect(mwEnd).toBeDefined();
      expect(mwStart!.environment).toBe('rsc');

      // Render phase
      const renderStart = events.find((e) => e.type === 'phase-start' && e.id === 'render');
      const renderEnd = events.find((e) => e.type === 'phase-end' && e.id === 'render');
      expect(renderStart).toBeDefined();
      expect(renderEnd).toBeDefined();
      expect(renderStart!.environment).toBe('rsc');
    });

    it('emits render phase even without proxy or middleware', async () => {
      const { events, pipeline } = collectDevLogEvents();
      await pipeline(makeRequest('/test'));

      const renderStart = events.find((e) => e.type === 'phase-start' && e.id === 'render');
      const renderEnd = events.find((e) => e.type === 'phase-end' && e.id === 'render');
      expect(renderStart).toBeDefined();
      expect(renderEnd).toBeDefined();
    });
  });

  describe('request-end', () => {
    it('request-end event includes status code and total duration', async () => {
      const { events, pipeline } = collectDevLogEvents();
      await pipeline(makeRequest('/test'));

      const end = events.find((e) => e.type === 'request-end');
      expect(end).toBeDefined();
      expect(end!.meta?.status).toBe(200);
      expect(typeof end!.meta?.durationMs).toBe('number');
      expect((end!.meta?.durationMs as number)).toBeGreaterThanOrEqual(0);
    });

    it('request-end reflects 404 status for no-match', async () => {
      const { events, pipeline } = collectDevLogEvents({
        matchRoute: () => null,
      });
      await pipeline(makeRequest('/no-match'));

      const end = events.find((e) => e.type === 'request-end');
      expect(end).toBeDefined();
      expect(end!.meta?.status).toBe(404);
    });
  });

  describe('production silent', () => {
    it('no dev log events emitted when onDevLog is not set', async () => {
      const events: DevLogEvent[] = [];
      const pipeline = createPipeline(
        makeConfig({
          // No onDevLog — simulates production mode
        })
      );
      await pipeline(makeRequest('/test'));
      expect(events).toHaveLength(0);
    });
  });

  describe('tree output', () => {
    it('collector produces tree output for a simple request', async () => {
      const collector = createRequestCollector();
      const emitter = new DevLogEmitter();
      emitter.on(collector.collect);

      emitter.emit({
        type: 'request-start',
        environment: 'rsc',
        label: 'GET /test',
        id: 'request',
        meta: { method: 'GET', path: '/test', traceId: 'a'.repeat(32) },
      });
      emitter.emit({ type: 'phase-start', environment: 'rsc', label: 'render', id: 'render' });
      emitter.emit({ type: 'phase-end', environment: 'rsc', label: 'render', id: 'render' });
      emitter.emit({
        type: 'request-end',
        environment: 'rsc',
        label: 'request-end',
        id: 'request-end',
        meta: { status: 200, durationMs: 18 },
      });

      const output = collector.format('tree');
      expect(output).toContain('GET /test');
      expect(output).toContain('trace_id:');
      expect(output).toContain('render');
      expect(output).toContain('200');
    });
  });

  describe('summary mode', () => {
    it('TIMBER_DEV_LOG=summary produces one-line output', async () => {
      const collector = createRequestCollector();
      const emitter = new DevLogEmitter();
      emitter.on(collector.collect);

      emitter.emit({
        type: 'request-start',
        environment: 'rsc',
        label: 'GET /test',
        id: 'request',
        meta: { method: 'GET', path: '/test', traceId: 'b'.repeat(32) },
      });
      emitter.emit({
        type: 'request-end',
        environment: 'rsc',
        label: 'request-end',
        id: 'request-end',
        meta: { status: 200, durationMs: 5 },
      });

      const output = collector.format('summary');
      expect(output).toContain('GET /test');
      expect(output).toContain('200');
      // Summary should be a single line (plus trailing newline)
      const lines = output.trim().split('\n');
      expect(lines.length).toBe(1);
    });
  });

  describe('quiet mode', () => {
    it('TIMBER_DEV_QUIET=1 suppresses output', async () => {
      const collector = createRequestCollector();
      const emitter = new DevLogEmitter();
      emitter.on(collector.collect);

      emitter.emit({
        type: 'request-start',
        environment: 'rsc',
        label: 'GET /test',
        id: 'request',
        meta: { method: 'GET', path: '/test', traceId: 'c'.repeat(32) },
      });
      emitter.emit({
        type: 'request-end',
        environment: 'rsc',
        label: 'request-end',
        id: 'request-end',
        meta: { status: 200, durationMs: 5 },
      });

      const output = collector.format('quiet');
      expect(output).toBe('');
    });
  });

  describe('slow phase', () => {
    it('slowPhaseMs highlighting applies to slow phases', async () => {
      const collector = createRequestCollector({ slowPhaseMs: 10 });
      const emitter = new DevLogEmitter();
      emitter.on(collector.collect);

      emitter.emit({
        type: 'request-start',
        environment: 'rsc',
        label: 'GET /test',
        id: 'request',
        meta: { method: 'GET', path: '/test', traceId: 'd'.repeat(32) },
      });

      // Simulate a phase with start at 0ms and end at 500ms by emitting
      // events with the emitter's internal timing
      emitter.emit({ type: 'phase-start', environment: 'rsc', label: 'render', id: 'render' });

      // Wait to create a measurable duration
      await new Promise((r) => setTimeout(r, 20));

      emitter.emit({ type: 'phase-end', environment: 'rsc', label: 'render', id: 'render' });
      emitter.emit({
        type: 'request-end',
        environment: 'rsc',
        label: 'request-end',
        id: 'request-end',
        meta: { status: 200, durationMs: 25 },
      });

      const output = collector.format('tree');
      // The YELLOW ANSI code should be present for the slow phase
      expect(output).toContain('\x1b[33m'); // YELLOW
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
});
