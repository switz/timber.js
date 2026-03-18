/**
 * Tests for dev-mode fetch instrumentation.
 *
 * Verifies:
 * - globalThis.fetch is patched in dev mode to create OTEL spans
 * - Fetch spans appear as children of the active parent span
 * - Span attributes include method, URL, status code
 * - Duration is recorded correctly
 * - Cleanup restores original fetch
 * - Fetch spans render correctly in the dev log tree
 * - Cache status headers are surfaced
 * - Errors are recorded without breaking the fetch call
 *
 * Design ref: 17-logging.md §"Dev Logging", LOCAL-289
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { instrumentDevFetch, type DevFetchCleanup } from '../packages/timber-app/src/server/dev-fetch-instrumentation';
import { formatSpanTree } from '../packages/timber-app/src/server/dev-logger';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import * as api from '@opentelemetry/api';

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

/** Create a mock ReadableSpan for tree formatter tests. */
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

// ─── Collecting Span Processor ───────────────────────────────────────────

class CollectingProcessor implements SpanProcessor {
  spans: ReadableSpan[] = [];
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    this.spans.push(span);
  }
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

// ─── OTEL Setup ──────────────────────────────────────────────────────────

let provider: BasicTracerProvider;
let contextManager: AsyncLocalStorageContextManager;
let processor: CollectingProcessor;
let cleanup: DevFetchCleanup | undefined;

function setupOtel() {
  processor = new CollectingProcessor();
  contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  api.context.setGlobalContextManager(contextManager);

  provider = new BasicTracerProvider({
    spanProcessors: [processor],
  });
  api.trace.setGlobalTracerProvider(provider);
}

function teardownOtel() {
  api.trace.disable();
  api.context.disable();
}

// ─── Tests: Fetch Instrumentation ────────────────────────────────────────

describe('dev fetch instrumentation', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setupOtel();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    teardownOtel();
    // Restore original fetch in case cleanup failed
    globalThis.fetch = originalFetch;
  });

  it('patches globalThis.fetch and restores on cleanup', () => {
    cleanup = instrumentDevFetch();
    expect(globalThis.fetch).not.toBe(originalFetch);
    cleanup();
    cleanup = undefined;
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('creates a timber.fetch span with method and URL attributes', async () => {
    // Mock the original fetch
    const mockResponse = new Response('ok', { status: 200 });
    globalThis.fetch = async () => mockResponse;

    cleanup = instrumentDevFetch();
    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('timber.page', async (parentSpan) => {
      await globalThis.fetch('https://api.example.com/products');
      parentSpan.end();
    });

    const fetchSpan = processor.spans.find((s) => s.name === 'timber.fetch');
    expect(fetchSpan).toBeDefined();
    expect(fetchSpan!.attributes['http.request.method']).toBe('GET');
    expect(fetchSpan!.attributes['http.url']).toBe('https://api.example.com/products');
    expect(fetchSpan!.attributes['http.response.status_code']).toBe(200);
  });

  it('parses method from Request object', async () => {
    const mockResponse = new Response('ok', { status: 201 });
    globalThis.fetch = async () => mockResponse;

    cleanup = instrumentDevFetch();
    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('timber.page', async (parentSpan) => {
      await globalThis.fetch(new Request('https://api.example.com/items', { method: 'POST' }));
      parentSpan.end();
    });

    const fetchSpan = processor.spans.find((s) => s.name === 'timber.fetch');
    expect(fetchSpan).toBeDefined();
    expect(fetchSpan!.attributes['http.request.method']).toBe('POST');
    expect(fetchSpan!.attributes['http.url']).toBe('https://api.example.com/items');
    expect(fetchSpan!.attributes['http.response.status_code']).toBe(201);
  });

  it('parses method from init options', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    globalThis.fetch = async () => mockResponse;

    cleanup = instrumentDevFetch();
    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('timber.page', async (parentSpan) => {
      await globalThis.fetch('https://api.example.com/items/1', { method: 'DELETE' });
      parentSpan.end();
    });

    const fetchSpan = processor.spans.find((s) => s.name === 'timber.fetch');
    expect(fetchSpan!.attributes['http.request.method']).toBe('DELETE');
  });

  it('is a child of the active parent span', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    globalThis.fetch = async () => mockResponse;

    cleanup = instrumentDevFetch();
    const tracer = api.trace.getTracer('test');

    let parentSpanId: string | undefined;
    await tracer.startActiveSpan('timber.page', async (parentSpan) => {
      parentSpanId = parentSpan.spanContext().spanId;
      await globalThis.fetch('https://api.example.com/data');
      parentSpan.end();
    });

    const fetchSpan = processor.spans.find((s) => s.name === 'timber.fetch');
    expect(fetchSpan!.parentSpanContext?.spanId).toBe(parentSpanId);
  });

  it('records error status on fetch failure without breaking the throw', async () => {
    const fetchError = new Error('network error');
    globalThis.fetch = async () => {
      throw fetchError;
    };

    cleanup = instrumentDevFetch();
    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('timber.page', async (parentSpan) => {
      await expect(globalThis.fetch('https://api.example.com/fail')).rejects.toThrow('network error');
      parentSpan.end();
    });

    const fetchSpan = processor.spans.find((s) => s.name === 'timber.fetch');
    expect(fetchSpan).toBeDefined();
    expect(fetchSpan!.status.code).toBe(api.SpanStatusCode.ERROR);
  });

  it('records cache status from X-Cache response header', async () => {
    const mockResponse = new Response('ok', {
      status: 200,
      headers: { 'X-Cache': 'HIT' },
    });
    globalThis.fetch = async () => mockResponse;

    cleanup = instrumentDevFetch();
    const tracer = api.trace.getTracer('test');

    await tracer.startActiveSpan('timber.page', async (parentSpan) => {
      await globalThis.fetch('https://api.example.com/cached');
      parentSpan.end();
    });

    const fetchSpan = processor.spans.find((s) => s.name === 'timber.fetch');
    expect(fetchSpan!.attributes['timber.cache_status']).toBe('HIT');
  });

  it('works without an active parent span (orphan fetch)', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    globalThis.fetch = async () => mockResponse;

    cleanup = instrumentDevFetch();

    // No active span — fetch should still work, span is a root
    await globalThis.fetch('https://api.example.com/orphan');

    const fetchSpan = processor.spans.find((s) => s.name === 'timber.fetch');
    expect(fetchSpan).toBeDefined();
    expect(fetchSpan!.attributes['http.url']).toBe('https://api.example.com/orphan');
  });

  it('passes through the original response unmodified', async () => {
    const mockResponse = new Response('response body', {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
    globalThis.fetch = async () => mockResponse;

    cleanup = instrumentDevFetch();

    const result = await globalThis.fetch('https://api.example.com/data');
    expect(result).toBe(mockResponse);
    expect(result.status).toBe(201);
  });
});

// ─── Tests: Tree Formatting with Fetch Spans ────────────────────────────

describe('fetch span tree formatting', () => {
  it('renders fetch spans as children of the component that made them', () => {
    const PAGE_SPAN_ID = 'cccc000000000001';
    const RENDER_ID = 'bbbb000000000003';
    const spans = [
      mockSpan({
        name: 'timber.fetch',
        spanId: 'dddd000000000001',
        parentSpanId: PAGE_SPAN_ID,
        startMs: 12,
        endMs: 89,
        attributes: {
          'http.request.method': 'GET',
          'http.url': 'https://api.example.com/products',
          'http.response.status_code': 200,
        },
      }),
      mockSpan({
        name: 'timber.fetch',
        spanId: 'dddd000000000002',
        parentSpanId: PAGE_SPAN_ID,
        startMs: 12,
        endMs: 45,
        attributes: {
          'http.request.method': 'GET',
          'http.url': 'https://api.example.com/user',
          'http.response.status_code': 200,
          'timber.cache_status': 'HIT',
        },
      }),
      mockSpan({
        name: 'timber.page',
        spanId: PAGE_SPAN_ID,
        parentSpanId: RENDER_ID,
        startMs: 6,
        endMs: 101,
        attributes: { 'timber.route': '/' },
      }),
      mockSpan({
        name: 'timber.layout',
        spanId: 'cccc000000000000',
        parentSpanId: RENDER_ID,
        startMs: 5,
        endMs: 5,
        attributes: { 'timber.segment': '/' },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: RENDER_ID,
        parentSpanId: ROOT_SPAN_ID,
        startMs: 1,
        endMs: 108,
      }),
      mockSpan({
        name: 'timber.ssr',
        spanId: 'bbbb000000000004',
        parentSpanId: ROOT_SPAN_ID,
        startMs: 9,
        endMs: 105,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 108,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];

    const output = stripAnsi(formatSpanTree(spans));

    // Fetch spans should appear in the tree
    expect(output).toContain('fetch GET https://api.example.com/products');
    expect(output).toContain('fetch GET https://api.example.com/user');
    // Cache status should be shown
    expect(output).toContain('[cache: HIT]');
    // Duration should be visible
    expect(output).toContain('12ms');
    expect(output).toContain('89ms');
  });

  it('shows fetch duration in parentheses', () => {
    const PAGE_SPAN_ID = 'cccc000000000001';
    const RENDER_ID = 'bbbb000000000003';
    const spans = [
      mockSpan({
        name: 'timber.fetch',
        spanId: 'dddd000000000001',
        parentSpanId: PAGE_SPAN_ID,
        startMs: 10,
        endMs: 87,
        attributes: {
          'http.request.method': 'GET',
          'http.url': 'https://api.example.com/data',
          'http.response.status_code': 200,
        },
      }),
      mockSpan({
        name: 'timber.page',
        spanId: PAGE_SPAN_ID,
        parentSpanId: RENDER_ID,
        startMs: 5,
        endMs: 100,
        attributes: { 'timber.route': '/' },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: RENDER_ID,
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

    const output = stripAnsi(formatSpanTree(spans));
    // Should show duration in parens: (77ms)
    expect(output).toContain('(77ms)');
  });

  it('shows POST method for non-GET fetches', () => {
    const PAGE_SPAN_ID = 'cccc000000000001';
    const RENDER_ID = 'bbbb000000000003';
    const spans = [
      mockSpan({
        name: 'timber.fetch',
        spanId: 'dddd000000000001',
        parentSpanId: PAGE_SPAN_ID,
        startMs: 10,
        endMs: 50,
        attributes: {
          'http.request.method': 'POST',
          'http.url': 'https://api.example.com/graphql',
          'http.response.status_code': 200,
        },
      }),
      mockSpan({
        name: 'timber.page',
        spanId: PAGE_SPAN_ID,
        parentSpanId: RENDER_ID,
        startMs: 5,
        endMs: 60,
        attributes: { 'timber.route': '/' },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: RENDER_ID,
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 60,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 60,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];

    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('fetch POST https://api.example.com/graphql');
  });

  it('shows error status for failed fetches', () => {
    const PAGE_SPAN_ID = 'cccc000000000001';
    const RENDER_ID = 'bbbb000000000003';
    const spans = [
      mockSpan({
        name: 'timber.fetch',
        spanId: 'dddd000000000001',
        parentSpanId: PAGE_SPAN_ID,
        startMs: 10,
        endMs: 50,
        attributes: {
          'http.request.method': 'GET',
          'http.url': 'https://api.example.com/fail',
          'timber.fetch_error': 'network error',
        },
        statusCode: 2, // ERROR
      }),
      mockSpan({
        name: 'timber.page',
        spanId: PAGE_SPAN_ID,
        parentSpanId: RENDER_ID,
        startMs: 5,
        endMs: 60,
        attributes: { 'timber.route': '/' },
      }),
      mockSpan({
        name: 'timber.render',
        spanId: RENDER_ID,
        parentSpanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 60,
      }),
      mockSpan({
        name: 'http.server.request',
        spanId: ROOT_SPAN_ID,
        startMs: 0,
        endMs: 60,
        attributes: {
          'http.request.method': 'GET',
          'url.path': '/',
          'http.response.status_code': 200,
        },
      }),
    ];

    const output = stripAnsi(formatSpanTree(spans));
    expect(output).toContain('fetch GET https://api.example.com/fail');
    expect(output).toContain('ERROR');
  });
});
