/**
 * Client-side segment tree merging tests.
 *
 * Tests the segment merger's ability to:
 * 1. Extract SegmentProvider boundaries from decoded RSC element trees
 * 2. Cache segment subtrees per segment path
 * 3. Merge partial RSC payloads with cached segments
 * 4. Preserve React element identity for reconciliation
 *
 * Ported from Next.js: test/unit/app-router/segment-cache.test.ts (concept)
 * See design/19-client-navigation.md §"Navigation Reconciliation"
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createElement, type ReactElement } from 'react';

import {
  SegmentElementCache,
  isSegmentProvider,
  getSegmentPath,
  extractSegments,
  cacheSegmentElements,
  replaceInnerSegment,
  mergeSegmentTree,
} from '../packages/timber-app/src/client/segment-merger';

// ─── Test Helpers ────────────────────────────────────────────────

/**
 * Create a mock SegmentProvider element. Uses a simple function component
 * with the `segments` prop signature that the merger looks for.
 */
function MockSegmentProvider({
  segments: _segments,
  parallelRouteKeys: _parallelRouteKeys,
  children,
}: {
  segments: string[];
  parallelRouteKeys?: string[];
  children?: React.ReactNode;
}) {
  return children;
}

function makeSegmentProvider(
  segmentParts: string[],
  children: React.ReactNode
): ReactElement {
  return createElement(MockSegmentProvider, {
    segments: segmentParts,
    parallelRouteKeys: [],
  }, children);
}

/** Create a simple div element to represent layout output */
function makeLayout(className: string, children: React.ReactNode): ReactElement {
  return createElement('div', { className }, children);
}

/** Create a simple element to represent page content */
function makePage(text: string): ReactElement {
  return createElement('span', { 'data-page': true }, text);
}

// ─── isSegmentProvider ───────────────────────────────────────────

describe('isSegmentProvider', () => {
  it('returns true for element with segments array prop', () => {
    const el = makeSegmentProvider([''], null);
    expect(isSegmentProvider(el)).toBe(true);
  });

  it('returns false for regular div element', () => {
    const el = createElement('div', { className: 'test' });
    expect(isSegmentProvider(el)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSegmentProvider(null)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isSegmentProvider('hello')).toBe(false);
  });

  it('returns false for element with non-array segments prop', () => {
    const el = createElement('div', { segments: 'not-array' });
    expect(isSegmentProvider(el)).toBe(false);
  });
});

// ─── getSegmentPath ──────────────────────────────────────────────

describe('getSegmentPath', () => {
  it('returns "/" for root segment [""]', () => {
    const el = makeSegmentProvider([''], null);
    expect(getSegmentPath(el)).toBe('/');
  });

  it('returns "/dashboard" for ["", "dashboard"]', () => {
    const el = makeSegmentProvider(['', 'dashboard'], null);
    expect(getSegmentPath(el)).toBe('/dashboard');
  });

  it('returns "/dashboard/settings" for nested segments', () => {
    const el = makeSegmentProvider(['', 'dashboard', 'settings'], null);
    expect(getSegmentPath(el)).toBe('/dashboard/settings');
  });
});

// ─── extractSegments ─────────────────────────────────────────────

describe('extractSegments', () => {
  it('extracts single root segment', () => {
    const tree = makeSegmentProvider([''], makePage('Home'));
    const segments = extractSegments(tree);

    expect(segments).toHaveLength(1);
    expect(segments[0].segmentPath).toBe('/');
  });

  it('extracts nested segments through layout output', () => {
    // Simulates: SegmentProvider(/) → div.root-layout → SegmentProvider(/dashboard) → page
    const tree = makeSegmentProvider([''],
      makeLayout('root-layout',
        makeSegmentProvider(['', 'dashboard'],
          makePage('Dashboard')
        )
      )
    );

    const segments = extractSegments(tree);
    expect(segments).toHaveLength(2);
    expect(segments[0].segmentPath).toBe('/');
    expect(segments[1].segmentPath).toBe('/dashboard');
  });

  it('extracts three-level deep segments', () => {
    const tree = makeSegmentProvider([''],
      makeLayout('root',
        makeSegmentProvider(['', 'dashboard'],
          makeLayout('dashboard',
            makeSegmentProvider(['', 'dashboard', 'settings'],
              makePage('Settings')
            )
          )
        )
      )
    );

    const segments = extractSegments(tree);
    expect(segments).toHaveLength(3);
    expect(segments[0].segmentPath).toBe('/');
    expect(segments[1].segmentPath).toBe('/dashboard');
    expect(segments[2].segmentPath).toBe('/dashboard/settings');
  });

  it('returns empty for non-React element', () => {
    expect(extractSegments('text')).toHaveLength(0);
    expect(extractSegments(null)).toHaveLength(0);
    expect(extractSegments(42)).toHaveLength(0);
  });

  it('handles array children', () => {
    // Layout with array children (e.g., <nav/> + <main><SegmentProvider/></main>)
    const innerSegment = makeSegmentProvider(['', 'dashboard'], makePage('Dash'));
    const tree = makeSegmentProvider([''],
      createElement('div', { className: 'root' },
        createElement('nav', null, 'Nav'),
        createElement('main', null, innerSegment)
      )
    );

    const segments = extractSegments(tree);
    expect(segments).toHaveLength(2);
    expect(segments[0].segmentPath).toBe('/');
    expect(segments[1].segmentPath).toBe('/dashboard');
  });
});

// ─── SegmentElementCache ─────────────────────────────────────────

describe('SegmentElementCache', () => {
  let cache: SegmentElementCache;

  beforeEach(() => {
    cache = new SegmentElementCache();
  });

  it('stores and retrieves entries', () => {
    const entry = {
      segmentPath: '/',
      element: makeSegmentProvider([''], makePage('Home')),
    };
    cache.set('/', entry);
    expect(cache.get('/')).toBe(entry);
  });

  it('returns undefined for missing entries', () => {
    expect(cache.get('/missing')).toBeUndefined();
  });

  it('reports size', () => {
    expect(cache.size).toBe(0);
    cache.set('/', { segmentPath: '/', element: makeSegmentProvider([''], null) });
    expect(cache.size).toBe(1);
  });

  it('clears all entries', () => {
    cache.set('/', { segmentPath: '/', element: makeSegmentProvider([''], null) });
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

// ─── cacheSegmentElements ────────────────────────────────────────

describe('cacheSegmentElements', () => {
  let cache: SegmentElementCache;

  beforeEach(() => {
    cache = new SegmentElementCache();
  });

  it('populates cache from a full element tree', () => {
    const tree = makeSegmentProvider([''],
      makeLayout('root',
        makeSegmentProvider(['', 'dashboard'],
          makePage('Dashboard')
        )
      )
    );

    cacheSegmentElements(tree, cache);

    expect(cache.has('/')).toBe(true);
    expect(cache.has('/dashboard')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('updates cache on subsequent calls', () => {
    const tree1 = makeSegmentProvider([''], makePage('Home'));
    cacheSegmentElements(tree1, cache);
    const original = cache.get('/')!;

    const tree2 = makeSegmentProvider([''], makePage('Updated'));
    cacheSegmentElements(tree2, cache);

    expect(cache.get('/')!).not.toBe(original);
  });
});

// ─── replaceInnerSegment ─────────────────────────────────────────

describe('replaceInnerSegment', () => {
  it('replaces inner SegmentProvider with new content (single child path)', () => {
    const cachedRoot = makeSegmentProvider([''],
      makeLayout('root',
        makeSegmentProvider(['', 'dashboard'],
          makePage('Old Dashboard')
        )
      )
    );

    const newContent = makeSegmentProvider(['', 'projects'],
      makePage('New Projects')
    );

    const merged = replaceInnerSegment(cachedRoot, newContent);

    // The merged tree should have the same outermost type
    expect(merged.type).toBe(cachedRoot.type);
    // The root SegmentProvider's props should be preserved
    expect((merged.props as Record<string, unknown>).segments).toEqual(['']);
  });

  it('replaces specific inner segment by path', () => {
    const cachedRoot = makeSegmentProvider([''],
      makeLayout('root',
        makeSegmentProvider(['', 'dashboard'],
          makeLayout('dashboard',
            makeSegmentProvider(['', 'dashboard', 'settings'],
              makePage('Old Settings')
            )
          )
        )
      )
    );

    const newContent = makePage('New Content');

    // Replace the /dashboard segment's inner content
    const merged = replaceInnerSegment(cachedRoot, newContent, '/dashboard');

    expect(merged.type).toBe(cachedRoot.type);
  });

  it('replaces children directly when no inner SegmentProvider found', () => {
    const leaf = makeSegmentProvider(['', 'page'], makePage('Old'));
    const merged = replaceInnerSegment(leaf, makePage('New'));

    expect(merged.type).toBe(leaf.type);
    // Children should be the new page
    const children = (merged.props as { children: React.ReactNode }).children;
    expect(children).toBeDefined();
  });

  it('handles array children in layout', () => {
    const inner = makeSegmentProvider(['', 'dashboard'], makePage('Old'));
    const cachedRoot = makeSegmentProvider([''],
      createElement('div', { className: 'root' },
        createElement('nav', null, 'Nav'),
        createElement('main', null, inner)
      )
    );

    const newContent = makeSegmentProvider(['', 'projects'], makePage('New'));
    const merged = replaceInnerSegment(cachedRoot, newContent);

    expect(merged.type).toBe(cachedRoot.type);
  });

  it('preserves component type identity for React reconciliation', () => {
    const cachedRoot = makeSegmentProvider([''],
      makeLayout('root',
        makeSegmentProvider(['', 'dashboard'], makePage('Old'))
      )
    );

    const newContent = makePage('New');
    const merged = replaceInnerSegment(cachedRoot, newContent);

    // The outermost element type must be preserved for React to reconcile
    expect(merged.type).toBe(cachedRoot.type);
    // Props (except children) should be preserved
    expect((merged.props as Record<string, unknown>).segments).toEqual(['']);
  });
});

// ─── mergeSegmentTree ────────────────────────────────────────────

describe('mergeSegmentTree', () => {
  let cache: SegmentElementCache;

  beforeEach(() => {
    cache = new SegmentElementCache();
  });

  it('returns partial payload when no segments are skipped', () => {
    const payload = makePage('Full');
    const result = mergeSegmentTree(payload, [], cache);
    expect(result).toBe(payload);
  });

  it('returns partial payload when it is not a valid React element', () => {
    const result = mergeSegmentTree('text', ['/'], cache);
    expect(result).toBe('text');
  });

  it('returns partial payload when cache is missing skipped segment', () => {
    const payload = makePage('Partial');
    const result = mergeSegmentTree(payload, ['/missing'], cache);
    expect(result).toBe(payload);
  });

  it('wraps partial payload with single cached segment', () => {
    // Cache root segment
    const fullTree = makeSegmentProvider([''],
      makeLayout('root',
        makeSegmentProvider(['', 'dashboard'],
          makePage('Old Dashboard')
        )
      )
    );
    cacheSegmentElements(fullTree, cache);

    // Server skips root, sends dashboard content directly
    const partialPayload = makeSegmentProvider(['', 'projects'],
      makePage('New Projects')
    );

    const merged = mergeSegmentTree(partialPayload, ['/'], cache);

    // The merged tree should be a SegmentProvider for root
    expect(isSegmentProvider(merged as ReactElement)).toBe(true);
    expect(getSegmentPath(merged as ReactElement)).toBe('/');
  });

  it('wraps partial payload with multiple cached segments', () => {
    // Cache a deep tree
    const fullTree = makeSegmentProvider([''],
      makeLayout('root',
        makeSegmentProvider(['', 'dashboard'],
          makeLayout('dashboard',
            makeSegmentProvider(['', 'dashboard', 'settings'],
              makePage('Old Settings')
            )
          )
        )
      )
    );
    cacheSegmentElements(fullTree, cache);

    // Server skips / and /dashboard, sends page directly
    const partialPayload = makePage('New Page');

    const merged = mergeSegmentTree(
      partialPayload,
      ['/', '/dashboard'],
      cache
    );

    // Result should be a full tree starting from root SegmentProvider
    expect(isSegmentProvider(merged as ReactElement)).toBe(true);
    expect(getSegmentPath(merged as ReactElement)).toBe('/');
  });

  it('preserves outermost element type for React reconciliation', () => {
    const fullTree = makeSegmentProvider([''],
      makeLayout('root',
        makeSegmentProvider(['', 'page'], makePage('Old'))
      )
    );
    cacheSegmentElements(fullTree, cache);

    const partialPayload = makePage('New');
    const merged = mergeSegmentTree(partialPayload, ['/'], cache) as ReactElement;

    // Must preserve MockSegmentProvider type for reconciliation
    expect(merged.type).toBe(MockSegmentProvider);
  });

  it('handles single-segment skip (common case)', () => {
    // Root layout wraps everything. On nav within /dashboard/*,
    // root is skipped, dashboard content changes.
    const fullTree = makeSegmentProvider([''],
      createElement('div', { className: 'root-layout' },
        createElement('nav', null, 'Navigation'),
        createElement('main', null,
          makeSegmentProvider(['', 'about'],
            makePage('About')
          )
        )
      )
    );
    cacheSegmentElements(fullTree, cache);

    // Navigate to /contact — root is skipped
    const partialPayload = makeSegmentProvider(['', 'contact'],
      makePage('Contact')
    );

    const merged = mergeSegmentTree(partialPayload, ['/'], cache);
    expect(isSegmentProvider(merged as ReactElement)).toBe(true);
    expect(getSegmentPath(merged as ReactElement)).toBe('/');
  });
});
