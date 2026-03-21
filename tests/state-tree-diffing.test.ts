/**
 * Server-side state tree diffing tests.
 *
 * Verifies that the server reads the X-Timber-State-Tree header from
 * client navigation requests and skips rendering sync layouts the client
 * already has cached. Async layouts always re-render.
 *
 * See design/19-client-navigation.md §"X-Timber-State-Tree Header"
 * See design/13-security.md §"State tree manipulation" (test #11)
 */
import { describe, it, expect, vi } from 'vitest';
import { buildRouteElement } from '../packages/timber-app/src/server/route-element-builder';
import type { ManifestSegmentNode } from '../packages/timber-app/src/server/route-matcher';
import {
  parseClientStateTree,
  shouldSkipSegment,
} from '../packages/timber-app/src/server/state-tree-diff';

// ─── Helpers ──────────────────────────────────────────────────────

function makeSegment(overrides: Partial<ManifestSegmentNode> = {}): ManifestSegmentNode {
  return {
    urlPath: '/',
    children: [],
    slots: {},
    ...overrides,
  } as ManifestSegmentNode;
}

// ─── parseClientStateTree ─────────────────────────────────────────

describe('parseClientStateTree', () => {
  it('parses valid state tree from header', () => {
    const req = new Request('http://localhost/', {
      headers: { 'X-Timber-State-Tree': JSON.stringify({ segments: ['/', '/dashboard'] }) },
    });
    const result = parseClientStateTree(req);
    expect(result).toEqual(new Set(['/', '/dashboard']));
  });

  it('returns null when header is missing', () => {
    const req = new Request('http://localhost/');
    expect(parseClientStateTree(req)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const req = new Request('http://localhost/', {
      headers: { 'X-Timber-State-Tree': 'not-json' },
    });
    expect(parseClientStateTree(req)).toBeNull();
  });

  it('returns null when segments is not an array', () => {
    const req = new Request('http://localhost/', {
      headers: { 'X-Timber-State-Tree': JSON.stringify({ segments: 'not-array' }) },
    });
    expect(parseClientStateTree(req)).toBeNull();
  });

  it('returns null for empty segments array', () => {
    const req = new Request('http://localhost/', {
      headers: { 'X-Timber-State-Tree': JSON.stringify({ segments: [] }) },
    });
    expect(parseClientStateTree(req)).toBeNull();
  });
});

// ─── shouldSkipSegment ────────────────────────────────────────────

describe('shouldSkipSegment', () => {
  // shouldSkipSegment is currently disabled (always returns false) because
  // the client doesn't have tree merging logic. When the server omits a
  // layout, React sees a different tree shape and re-mounts everything,
  // destroying DOM state. All tests verify it returns false.

  it('returns false for sync layout even when client has it (disabled)', () => {
    const clientSegments = new Set(['/']);
    function SyncLayout() {
      return 'layout';
    }
    expect(shouldSkipSegment('/', SyncLayout, false, clientSegments)).toBe(false);
  });

  it('returns false for async layout', () => {
    const clientSegments = new Set(['/']);
    async function AsyncLayout() {
      return 'layout';
    }
    expect(shouldSkipSegment('/', AsyncLayout, false, clientSegments)).toBe(false);
  });

  it('returns false when client does not have segment', () => {
    const clientSegments = new Set(['/']);
    function SyncLayout() {
      return 'layout';
    }
    expect(shouldSkipSegment('/dashboard', SyncLayout, false, clientSegments)).toBe(false);
  });

  it('returns false for leaf segment', () => {
    const clientSegments = new Set(['/', '/projects']);
    function SyncLayout() {
      return 'layout';
    }
    expect(shouldSkipSegment('/projects', SyncLayout, true, clientSegments)).toBe(false);
  });

  it('returns false when clientSegments is null', () => {
    function SyncLayout() {
      return 'layout';
    }
    expect(shouldSkipSegment('/', SyncLayout, false, null)).toBe(false);
  });
});

// ─── buildRouteElement with state tree diffing ────────────────────

describe('buildRouteElement with state tree diffing', () => {
  it('renders sync layout even when listed in client state tree (skip disabled)', async () => {
    const rootLayoutFn = vi.fn(({ children }: { children: unknown }) => children);
    const pageFn = vi.fn(() => 'Page content');

    const rootSegment = makeSegment({
      urlPath: '/',
      layout: {
        filePath: 'app/layout.tsx',
        load: async () => ({ default: rootLayoutFn }),
      },
    });
    const pageSegment = makeSegment({
      urlPath: '/projects',
      segmentName: 'projects',
      page: {
        filePath: 'app/projects/page.tsx',
        load: async () => ({ default: pageFn }),
      },
    });

    // Client has root layout cached — but skip is disabled
    const clientStateTree = new Set(['/']);

    const result = await buildRouteElement(
      new Request('http://localhost/projects'),
      { segments: [rootSegment, pageSegment] as never, params: {} },
      undefined,
      clientStateTree
    );

    // Layout should still render (skip is disabled)
    expect(result.element).toBeDefined();
    expect(result.layoutComponents).toHaveLength(1);
  });

  it('does NOT skip async layout even when listed in client state tree', async () => {
    const asyncLayoutFn = vi.fn(async ({ children }: { children: unknown }) => children);
    const pageFn = vi.fn(() => 'Page content');

    const rootSegment = makeSegment({
      urlPath: '/',
      layout: {
        filePath: 'app/layout.tsx',
        load: async () => ({ default: asyncLayoutFn }),
      },
    });
    const pageSegment = makeSegment({
      urlPath: '/dashboard',
      segmentName: 'dashboard',
      page: {
        filePath: 'app/dashboard/page.tsx',
        load: async () => ({ default: pageFn }),
      },
    });

    const clientStateTree = new Set(['/']);

    const result = await buildRouteElement(
      new Request('http://localhost/dashboard'),
      { segments: [rootSegment, pageSegment] as never, params: {} },
      undefined,
      clientStateTree
    );

    // Async layout should still be in the tree (not skipped)
    expect(result.element).toBeDefined();
    // The layout component is wrapped in a trace, so we check layoutComponents
    expect(result.layoutComponents).toHaveLength(1);
  });

  it('still runs access.ts for skipped segments (security)', async () => {
    const accessFn = vi.fn();
    const rootLayoutFn = vi.fn(({ children }: { children: unknown }) => children);
    const pageFn = vi.fn(() => 'Page');

    const rootSegment = makeSegment({
      urlPath: '/',
      layout: {
        filePath: 'app/layout.tsx',
        load: async () => ({ default: rootLayoutFn }),
      },
      access: {
        filePath: 'app/access.ts',
        load: async () => ({ default: accessFn }),
      },
    });
    const pageSegment = makeSegment({
      urlPath: '/page',
      segmentName: 'page',
      page: {
        filePath: 'app/page/page.tsx',
        load: async () => ({ default: pageFn }),
      },
    });

    const clientStateTree = new Set(['/']);

    await buildRouteElement(
      new Request('http://localhost/page'),
      { segments: [rootSegment, pageSegment] as never, params: {} },
      undefined,
      clientStateTree
    );

    // Access.ts must still run even though layout is skipped
    expect(accessFn).toHaveBeenCalledTimes(1);
  });

  it('still resolves metadata for skipped segments', async () => {
    const rootLayoutFn = vi.fn(({ children }: { children: unknown }) => children);
    const pageFn = vi.fn(() => 'Page');

    const rootSegment = makeSegment({
      urlPath: '/',
      layout: {
        filePath: 'app/layout.tsx',
        load: async () => ({
          default: rootLayoutFn,
          metadata: { title: 'Site Title' },
        }),
      },
    });
    const pageSegment = makeSegment({
      urlPath: '/about',
      segmentName: 'about',
      page: {
        filePath: 'app/about/page.tsx',
        load: async () => ({ default: pageFn }),
      },
    });

    const clientStateTree = new Set(['/']);

    const result = await buildRouteElement(
      new Request('http://localhost/about'),
      { segments: [rootSegment, pageSegment] as never, params: {} },
      undefined,
      clientStateTree
    );

    // Metadata from skipped layout should still be resolved
    const titleElement = result.headElements.find((el) => el.tag === 'title');
    expect(titleElement).toBeDefined();
    expect(titleElement!.content).toBe('Site Title');
  });

  it('without state tree, all layouts render normally', async () => {
    const rootLayoutFn = vi.fn(({ children }: { children: unknown }) => children);
    const pageFn = vi.fn(() => 'Page content');

    const rootSegment = makeSegment({
      urlPath: '/',
      layout: {
        filePath: 'app/layout.tsx',
        load: async () => ({ default: rootLayoutFn }),
      },
    });
    const pageSegment = makeSegment({
      urlPath: '/projects',
      segmentName: 'projects',
      page: {
        filePath: 'app/projects/page.tsx',
        load: async () => ({ default: pageFn }),
      },
    });

    // No client state tree — full render
    const result = await buildRouteElement(
      new Request('http://localhost/projects'),
      { segments: [rootSegment, pageSegment] as never, params: {} },
    );

    expect(result.element).toBeDefined();
    // Layout components still collected even when rendered
    expect(result.layoutComponents).toHaveLength(1);
  });

  it('renders all layouts in a deep route even with state tree (skip disabled)', async () => {
    const rootLayoutFn = vi.fn(({ children }: { children: unknown }) => children);
    const dashLayoutFn = vi.fn(({ children }: { children: unknown }) => children);
    const pageFn = vi.fn(() => 'Page');

    const rootSegment = makeSegment({
      urlPath: '/',
      layout: {
        filePath: 'app/layout.tsx',
        load: async () => ({ default: rootLayoutFn }),
      },
    });
    const dashSegment = makeSegment({
      urlPath: '/dashboard',
      segmentName: 'dashboard',
      layout: {
        filePath: 'app/dashboard/layout.tsx',
        load: async () => ({ default: dashLayoutFn }),
      },
    });
    const pageSegment = makeSegment({
      urlPath: '/dashboard/settings',
      segmentName: 'settings',
      page: {
        filePath: 'app/dashboard/settings/page.tsx',
        load: async () => ({ default: pageFn }),
      },
    });

    const clientStateTree = new Set(['/', '/dashboard']);

    const result = await buildRouteElement(
      new Request('http://localhost/dashboard/settings'),
      { segments: [rootSegment, dashSegment, pageSegment] as never, params: {} },
      undefined,
      clientStateTree
    );

    // Both layouts should render (skip is disabled)
    expect(result.element).toBeDefined();
    expect(result.layoutComponents).toHaveLength(2);
  });
});
