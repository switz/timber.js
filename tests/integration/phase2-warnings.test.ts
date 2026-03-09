/**
 * Phase 2 Integration Tests — Dev Warnings & Cross-Feature
 *
 * Tests dev warning behavior across features, plus cross-feature interactions
 * between navigation, actions, and observability subsystems.
 *
 * Acceptance criteria from timber-dch.1.6: "Dev warnings fire correctly"
 *
 * Ported from acceptance criteria in timber-dch.1.6.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  warnSuspenseWrappingChildren,
  warnRedirectInSlotAccess,
  warnDenyAfterFlush,
  warnSlowSlotWithoutSuspense,
  _resetWarnings,
} from '../../packages/timber-app/src/server/dev-warnings';
import { createPipeline } from '../../packages/timber-app/src/server/pipeline';
import { deny, DenySignal } from '../../packages/timber-app/src/server/primitives';
import { createRouter } from '../../packages/timber-app/src/client/router';
import { type SegmentNode } from '../../packages/timber-app/src/client/segment-cache';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

// ─── Dev Warnings Fire Correctly ────────────────────────────────────────────

describe('dev warnings', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWarnings();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('multiple warning types coexist in same request without interference', () => {
    warnSuspenseWrappingChildren('app/layout.tsx');
    warnRedirectInSlotAccess('@admin');
    warnDenyAfterFlush('deny');
    warnSlowSlotWithoutSuspense('@sidebar', 350);

    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

    expect(consoleWarnSpy.mock.calls[0]![0]).toContain('Suspense');
    expect(consoleWarnSpy.mock.calls[1]![0]).toContain('@sidebar');
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('redirect()');
    expect(consoleErrorSpy.mock.calls[1]![0]).toContain('deny()');
  });

  it('warnings suppressed in production across all warning types', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      _resetWarnings();

      warnSuspenseWrappingChildren('app/layout.tsx');
      warnRedirectInSlotAccess('@admin');
      warnDenyAfterFlush('deny');
      warnSlowSlotWithoutSuspense('@sidebar', 500);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('deduplication works across different warning types independently', () => {
    warnSuspenseWrappingChildren('app/layout.tsx');
    warnRedirectInSlotAccess('@admin');

    warnSuspenseWrappingChildren('app/layout.tsx');
    warnRedirectInSlotAccess('@admin');

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('deny() signal in pipeline triggers correct status and warning integration', async () => {
    const handler = createPipeline({
      matchRoute: () => ({
        segments: [],
        params: {},
      }),
      render: () => {
        try {
          deny(403);
        } catch (e) {
          if (e instanceof DenySignal) {
            warnDenyAfterFlush('deny');
            return new Response('Forbidden', { status: e.status });
          }
          throw e;
        }
        return new Response('OK');
      },
    });

    const res = await handler(makeRequest('/admin'));
    expect(res.status).toBe(403);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('deny()'));
  });
});

// ─── Cross-Feature: Navigation + Actions ────────────────────────────────────

describe('cross-feature interactions', () => {
  it('router navigation with prefetch cache + action revalidation clears stale data', async () => {
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
    mockFetch.mockResolvedValue(
      new Response('fresh-payload', { headers: { 'content-type': 'text/x-component' } })
    );

    const router = createRouter({
      fetch: mockFetch,
      pushState: vi.fn(),
      replaceState: vi.fn(),
      scrollTo: vi.fn(),
      getCurrentUrl: () => '/dashboard',
      getScrollY: () => 0,
    });

    router.prefetchCache.set('/products', 'stale-prefetch-data');

    await router.navigate('/products');
    expect(mockFetch).not.toHaveBeenCalled();

    mockFetch.mockClear();
    await router.refresh();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('segment cache serialization after multiple navigations', async () => {
    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
    mockFetch.mockResolvedValue(
      new Response('payload', { headers: { 'content-type': 'text/x-component' } })
    );

    const router = createRouter({
      fetch: mockFetch,
      pushState: vi.fn(),
      replaceState: vi.fn(),
      scrollTo: vi.fn(),
      getCurrentUrl: () => '/',
      getScrollY: () => 0,
    });

    const root: SegmentNode = {
      segment: '/',
      payload: 'root-layout',
      isAsync: false,
      children: new Map(),
    };
    const dashboard: SegmentNode = {
      segment: '/dashboard',
      payload: 'dashboard-layout',
      isAsync: false,
      children: new Map(),
    };
    const settings: SegmentNode = {
      segment: '/settings',
      payload: 'settings-page',
      isAsync: true,
      children: new Map(),
    };
    dashboard.children.set('/settings', settings);
    root.children.set('/dashboard', dashboard);
    router.segmentCache.set('/', root);

    await router.navigate('/dashboard/settings');

    const [, options] = mockFetch.mock.calls[0]! as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    const stateTree = JSON.parse(headers['X-Timber-State-Tree']);

    expect(stateTree.segments).toContain('/');
    expect(stateTree.segments).toContain('/dashboard');
    expect(stateTree.segments).not.toContain('/settings');
  });

  it('history stack + pending state: rapid navigations settle correctly', async () => {
    let resolveFirst!: (res: Response) => void;
    let resolveSecond!: (res: Response) => void;

    const mockFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
    mockFetch
      .mockReturnValueOnce(
        new Promise<Response>((r) => {
          resolveFirst = r;
        })
      )
      .mockReturnValueOnce(
        new Promise<Response>((r) => {
          resolveSecond = r;
        })
      );

    const router = createRouter({
      fetch: mockFetch,
      pushState: vi.fn(),
      replaceState: vi.fn(),
      scrollTo: vi.fn(),
      getCurrentUrl: () => '/',
      getScrollY: () => 0,
    });

    const nav1 = router.navigate('/page-a');
    expect(router.isPending()).toBe(true);

    const nav2 = router.navigate('/page-b');
    expect(router.isPending()).toBe(true);

    resolveFirst(new Response('a', { headers: { 'content-type': 'text/x-component' } }));
    resolveSecond(new Response('b', { headers: { 'content-type': 'text/x-component' } }));

    await nav1;
    await nav2;

    expect(router.isPending()).toBe(false);
    expect(router.historyStack.get('/page-a')).toBeDefined();
    expect(router.historyStack.get('/page-b')).toBeDefined();
  });
});
