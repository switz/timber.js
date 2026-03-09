import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Segment Cache ───────────────────────────────────────────────

import {
  SegmentCache,
  type SegmentNode,
} from '../packages/timber-app/src/client/segment-cache';

describe('SegmentCache', () => {
  let cache: SegmentCache;

  beforeEach(() => {
    cache = new SegmentCache();
  });

  it('stores and retrieves a segment node', () => {
    const node: SegmentNode = {
      segment: '/',
      payload: { type: 'root' },
      isAsync: false,
      children: new Map(),
    };
    cache.set('/', node);
    expect(cache.get('/')).toBe(node);
  });

  it('returns undefined for missing segments', () => {
    expect(cache.get('/missing')).toBeUndefined();
  });

  it('builds a tree with nested segments', () => {
    const root: SegmentNode = {
      segment: '/',
      payload: { type: 'root-layout' },
      isAsync: false,
      children: new Map(),
    };
    const dashboard: SegmentNode = {
      segment: '/dashboard',
      payload: { type: 'dashboard-layout' },
      isAsync: false,
      children: new Map(),
    };
    root.children.set('/dashboard', dashboard);
    cache.set('/', root);

    expect(cache.get('/')!.children.get('/dashboard')).toBe(dashboard);
  });

  it('overwrites existing segment', () => {
    const original: SegmentNode = {
      segment: '/',
      payload: 'v1',
      isAsync: false,
      children: new Map(),
    };
    const updated: SegmentNode = {
      segment: '/',
      payload: 'v2',
      isAsync: false,
      children: new Map(),
    };
    cache.set('/', original);
    cache.set('/', updated);
    expect(cache.get('/')!.payload).toBe('v2');
  });

  it('clears all segments', () => {
    cache.set('/', {
      segment: '/',
      payload: null,
      isAsync: false,
      children: new Map(),
    });
    cache.clear();
    expect(cache.get('/')).toBeUndefined();
  });

  it('serializes mounted segments for state tree header', () => {
    const root: SegmentNode = {
      segment: '/',
      payload: 'root',
      isAsync: false,
      children: new Map(),
    };
    const dash: SegmentNode = {
      segment: '/dashboard',
      payload: 'dash',
      isAsync: false,
      children: new Map(),
    };
    const projects: SegmentNode = {
      segment: '/projects',
      payload: 'proj',
      isAsync: true,
      children: new Map(),
    };
    dash.children.set('/projects', projects);
    root.children.set('/dashboard', dash);
    cache.set('/', root);

    const stateTree = cache.serializeStateTree();
    // Only sync segments are included (async segments always re-render)
    expect(stateTree).toEqual({ segments: ['/', '/dashboard'] });
  });

  it('serializeStateTree returns empty when no root', () => {
    expect(cache.serializeStateTree()).toEqual({ segments: [] });
  });
});

// ─── Prefetch Cache ──────────────────────────────────────────────

import { PrefetchCache } from '../packages/timber-app/src/client/segment-cache';

describe('PrefetchCache', () => {
  let prefetchCache: PrefetchCache;

  beforeEach(() => {
    vi.useFakeTimers();
    prefetchCache = new PrefetchCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves a prefetched payload', () => {
    prefetchCache.set('/projects', 'payload-data');
    expect(prefetchCache.get('/projects')).toBe('payload-data');
  });

  it('prefetch cache 30s TTL', () => {
    prefetchCache.set('/projects', 'payload-data');

    // Still available at 29s
    vi.advanceTimersByTime(29_000);
    expect(prefetchCache.get('/projects')).toBe('payload-data');

    // Expired at 30s
    vi.advanceTimersByTime(1_000);
    expect(prefetchCache.get('/projects')).toBeUndefined();
  });

  it('returns undefined for missing entries', () => {
    expect(prefetchCache.get('/missing')).toBeUndefined();
  });

  it('consumes entry (removes after get when consume=true)', () => {
    prefetchCache.set('/projects', 'payload-data');
    expect(prefetchCache.consume('/projects')).toBe('payload-data');
    expect(prefetchCache.get('/projects')).toBeUndefined();
  });
});

// ─── History Stack ───────────────────────────────────────────────

import {
  HistoryStack,
  type HistoryEntry,
} from '../packages/timber-app/src/client/history';

describe('HistoryStack', () => {
  let stack: HistoryStack;

  beforeEach(() => {
    stack = new HistoryStack();
  });

  it('stores and retrieves entries by URL', () => {
    const entry: HistoryEntry = { payload: 'rsc-data', scrollY: 100 };
    stack.push('/dashboard', entry);
    expect(stack.get('/dashboard')).toEqual(entry);
  });

  it('history replay — back/forward uses cached payload', () => {
    stack.push('/page-a', { payload: 'a', scrollY: 0 });
    stack.push('/page-b', { payload: 'b', scrollY: 200 });

    // Simulating back navigation: look up /page-a
    const entry = stack.get('/page-a');
    expect(entry).toBeDefined();
    expect(entry!.payload).toBe('a');
    expect(entry!.scrollY).toBe(0);
  });

  it('overwrites entry for same URL with updated scroll', () => {
    stack.push('/dashboard', { payload: 'v1', scrollY: 0 });
    stack.push('/dashboard', { payload: 'v2', scrollY: 300 });
    expect(stack.get('/dashboard')!.scrollY).toBe(300);
  });

  it('returns undefined for unvisited URL', () => {
    expect(stack.get('/never-visited')).toBeUndefined();
  });
});

// ─── Router ──────────────────────────────────────────────────────

import {
  createRouter,
  type RouterInstance,
} from '../packages/timber-app/src/client/router';

describe('Router', () => {
  let router: RouterInstance;
  let mockFetch: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

  // Minimal DOM mocks
  const mockPushState = vi.fn();
  const mockReplaceState = vi.fn();
  const mockScrollTo = vi.fn();

  beforeEach(() => {
    mockFetch = vi.fn();
    mockPushState.mockClear();
    mockReplaceState.mockClear();
    mockScrollTo.mockClear();

    router = createRouter({
      // Inject mocks for testability
      fetch: mockFetch,
      pushState: mockPushState,
      replaceState: mockReplaceState,
      scrollTo: mockScrollTo,
      getCurrentUrl: () => '/dashboard',
      getScrollY: () => 0,
    });
  });

  describe('navigate', () => {
    it('sends RSC payload request with correct headers', async () => {
      const rscPayload = 'rsc-stream-data';
      mockFetch.mockResolvedValueOnce(
        new Response(rscPayload, {
          headers: { 'content-type': 'text/x-component' },
        }),
      );

      await router.navigate('/projects');

      expect(mockFetch).toHaveBeenCalledWith(
        '/projects',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'text/x-component',
          }),
        }),
      );
    });

    it('includes X-Timber-State-Tree header for segment diff skip sync', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('payload', {
          headers: { 'content-type': 'text/x-component' },
        }),
      );

      await router.navigate('/projects');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['X-Timber-State-Tree']).toBeDefined();
      const stateTree = JSON.parse(headers['X-Timber-State-Tree']);
      expect(stateTree).toHaveProperty('segments');
    });

    it('calls pushState for forward navigation', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('payload', {
          headers: { 'content-type': 'text/x-component' },
        }),
      );

      await router.navigate('/projects');

      expect(mockPushState).toHaveBeenCalledWith(
        expect.anything(),
        '',
        '/projects',
      );
    });

    it('scrolls to top on forward navigation', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('payload', {
          headers: { 'content-type': 'text/x-component' },
        }),
      );

      await router.navigate('/projects');
      expect(mockScrollTo).toHaveBeenCalledWith(0, 0);
    });

    it('skips scroll when scroll=false option', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('payload', {
          headers: { 'content-type': 'text/x-component' },
        }),
      );

      await router.navigate('/projects', { scroll: false });
      expect(mockScrollTo).not.toHaveBeenCalled();
    });

    it('uses prefetch cache if available', async () => {
      // Prime the prefetch cache
      router.prefetchCache.set('/projects', 'prefetched-payload');

      await router.navigate('/projects');

      // Should NOT have called fetch since prefetch cache had the payload
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('router refresh', () => {
    it('router.refresh() does NOT send state tree header', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('full-payload', {
          headers: { 'content-type': 'text/x-component' },
        }),
      );

      await router.refresh();

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['X-Timber-State-Tree']).toBeUndefined();
    });

    it('router.refresh() fetches current URL', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('full-payload', {
          headers: { 'content-type': 'text/x-component' },
        }),
      );

      await router.refresh();

      expect(mockFetch).toHaveBeenCalledWith(
        '/dashboard',
        expect.anything(),
      );
    });
  });

  describe('popstate (back/forward)', () => {
    it('scroll restoration on back/forward', async () => {
      // Simulate having visited /projects with scrollY=250
      router.historyStack.push('/projects', {
        payload: 'projects-payload',
        scrollY: 250,
      });

      await router.handlePopState('/projects');

      // Should restore scroll position
      expect(mockScrollTo).toHaveBeenCalledWith(0, 250);
    });

    it('replays cached payload without server roundtrip', async () => {
      router.historyStack.push('/projects', {
        payload: 'cached-payload',
        scrollY: 0,
      });

      await router.handlePopState('/projects');

      // Should NOT make a fetch — uses cached payload
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fetches from server if history entry missing', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('payload', {
          headers: { 'content-type': 'text/x-component' },
        }),
      );

      await router.handlePopState('/unknown-page');

      expect(mockFetch).toHaveBeenCalledWith(
        '/unknown-page',
        expect.anything(),
      );
    });
  });

  describe('navigation pending', () => {
    it('navigation pending state during fetch', async () => {
      // Create a deferred fetch
      let resolveFetch!: (res: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
      );

      expect(router.isPending()).toBe(false);

      const navPromise = router.navigate('/projects');
      expect(router.isPending()).toBe(true);

      resolveFetch(
        new Response('payload', {
          headers: { 'content-type': 'text/x-component' },
        }),
      );
      await navPromise;

      expect(router.isPending()).toBe(false);
    });
  });
});

// ─── Link Component ──────────────────────────────────────────────

import {
  validateLinkHref,
  buildLinkProps,
} from '../packages/timber-app/src/client/link';

describe('Link', () => {
  describe('link scheme validation', () => {
    it('rejects javascript: scheme', () => {
      expect(() => validateLinkHref('javascript:alert(1)')).toThrow();
    });

    it('rejects data: scheme', () => {
      expect(() => validateLinkHref('data:text/html,<h1>evil</h1>')).toThrow();
    });

    it('rejects vbscript: scheme', () => {
      expect(() => validateLinkHref('vbscript:msgbox')).toThrow();
    });

    it('rejects javascript: with mixed case', () => {
      expect(() => validateLinkHref('JavaScript:alert(1)')).toThrow();
    });

    it('rejects javascript: with whitespace', () => {
      expect(() => validateLinkHref('  javascript:alert(1)')).toThrow();
    });

    it('allows relative paths', () => {
      expect(() => validateLinkHref('/dashboard')).not.toThrow();
    });

    it('allows hash links', () => {
      expect(() => validateLinkHref('#section')).not.toThrow();
    });

    it('allows external http URLs', () => {
      expect(() => validateLinkHref('https://example.com')).not.toThrow();
    });
  });

  describe('link progressive enhancement', () => {
    it('builds props with href as plain anchor', () => {
      const props = buildLinkProps({ href: '/dashboard' });
      expect(props.href).toBe('/dashboard');
      // Should always render as a plain <a> — no special data attributes required
      expect(props.href).toBeDefined();
    });
  });

  describe('link intercept', () => {
    it('marks internal links for client navigation', () => {
      const props = buildLinkProps({ href: '/dashboard' });
      expect(props['data-timber-link']).toBe(true);
    });

    it('does NOT mark external links for client navigation', () => {
      const props = buildLinkProps({ href: 'https://example.com' });
      expect(props['data-timber-link']).toBeUndefined();
    });
  });

  describe('link prefetch', () => {
    it('sets prefetch data attribute when prefetch prop is true', () => {
      const props = buildLinkProps({ href: '/projects', prefetch: true });
      expect(props['data-timber-prefetch']).toBe(true);
    });

    it('does not set prefetch data attribute by default', () => {
      const props = buildLinkProps({ href: '/projects' });
      expect(props['data-timber-prefetch']).toBeUndefined();
    });
  });

  describe('link scroll option', () => {
    it('sets scroll=false data attribute', () => {
      const props = buildLinkProps({ href: '/tabs/1', scroll: false });
      expect(props['data-timber-scroll']).toBe('false');
    });

    it('does not set scroll data attribute by default (scroll=true)', () => {
      const props = buildLinkProps({ href: '/tabs/1' });
      expect(props['data-timber-scroll']).toBeUndefined();
    });
  });
});

// ─── Async layout re-render ──────────────────────────────────────

describe('Segment diffing', () => {
  it('segment diff skip sync — sync segments appear in state tree', () => {
    const cache = new SegmentCache();
    const root: SegmentNode = {
      segment: '/',
      payload: 'root',
      isAsync: false,
      children: new Map(),
    };
    const syncLayout: SegmentNode = {
      segment: '/dashboard',
      payload: 'dash',
      isAsync: false,
      children: new Map(),
    };
    root.children.set('/dashboard', syncLayout);
    cache.set('/', root);

    const tree = cache.serializeStateTree();
    expect(tree.segments).toContain('/');
    expect(tree.segments).toContain('/dashboard');
  });

  it('async layout re-render — async segments excluded from state tree', () => {
    const cache = new SegmentCache();
    const root: SegmentNode = {
      segment: '/',
      payload: 'root',
      isAsync: false,
      children: new Map(),
    };
    const asyncLayout: SegmentNode = {
      segment: '/dashboard',
      payload: 'dash',
      isAsync: true,
      children: new Map(),
    };
    root.children.set('/dashboard', asyncLayout);
    cache.set('/', root);

    const tree = cache.serializeStateTree();
    expect(tree.segments).toContain('/');
    // Async layouts are NOT in the state tree — server always re-renders them
    expect(tree.segments).not.toContain('/dashboard');
  });
});
