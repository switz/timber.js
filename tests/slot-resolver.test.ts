/**
 * Tests for parallel slot resolution.
 *
 * Verifies that slots correctly match pages or fall back to default.tsx
 * based on the current route's segment chain. Also tests that slots get
 * independent error boundaries and layouts from their matched segment chain.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveSlotElement } from '../packages/timber-app/src/server/slot-resolver';
import type { ManifestSegmentNode } from '../packages/timber-app/src/server/route-matcher';

/** Test-only RouteMatch using ManifestSegmentNode (avoids RouteFile vs ManifestFile mismatch) */
interface TestRouteMatch {
  segments: ManifestSegmentNode[];
  params: Record<string, string>;
}

// Minimal mock createElement
const h = (...args: unknown[]) =>
  ({ type: args[0], props: args[1] }) as unknown as React.ReactElement;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSegment(overrides: Record<string, any>): ManifestSegmentNode {
  return {
    segmentName: '',
    segmentType: 'static',
    urlPath: '/',
    children: [],
    slots: {},
    ...overrides,
  } as ManifestSegmentNode;
}

function makeFile(name: string) {
  return {
    load: vi.fn().mockResolvedValue({ default: () => `<${name} />` }),
    filePath: `/app/${name}.tsx`,
  };
}

describe('resolveSlotElement', () => {
  it('returns slot page when URL matches slot root', async () => {
    const slotNode = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/parallel',
      page: makeFile('SidebarHome'),
      default: makeFile('SidebarDefault'),
    });

    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({
          segmentName: 'parallel',
          urlPath: '/parallel',
          page: makeFile('ParallelHome'),
        }),
      ],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull();
    expect((result as { type: unknown }).type).toBe(
      ((await slotNode.page!.load()) as Record<string, unknown>).default
    );
  });

  it('returns slot child page when URL matches slot child', async () => {
    const slotNode = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/parallel',
      page: makeFile('SidebarHome'),
      default: makeFile('SidebarDefault'),
      children: [
        makeSegment({
          segmentName: 'projects',
          segmentType: 'static',
          urlPath: '/parallel/projects',
          page: makeFile('SidebarProjects'),
        }),
      ],
    });

    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({ segmentName: 'parallel', urlPath: '/parallel' }),
        makeSegment({
          segmentName: 'projects',
          urlPath: '/parallel/projects',
          page: makeFile('ProjectsPage'),
        }),
      ],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull();
    const projectsPage = (
      await (
        slotNode.children as Array<{ page: { load: () => Promise<Record<string, unknown>> } }>
      )[0].page.load()
    ).default;
    expect((result as { type: unknown }).type).toBe(projectsPage);
  });

  it('returns default.tsx when URL does not match any slot page', async () => {
    const slotNode = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/parallel',
      page: makeFile('SidebarHome'),
      default: makeFile('SidebarDefault'),
      children: [
        makeSegment({
          segmentName: 'projects',
          segmentType: 'static',
          urlPath: '/parallel/projects',
          page: makeFile('SidebarProjects'),
        }),
      ],
    });

    // URL is /parallel/about — no matching child in slot
    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({ segmentName: 'parallel', urlPath: '/parallel' }),
        makeSegment({
          segmentName: 'about',
          urlPath: '/parallel/about',
          page: makeFile('AboutPage'),
        }),
      ],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull();
    const defaultComp = ((await slotNode.default!.load()) as Record<string, unknown>).default;
    expect((result as { type: unknown }).type).toBe(defaultComp);
  });

  it('returns null when slot has no page and no default', async () => {
    const slotNode = makeSegment({
      segmentName: '@modal',
      segmentType: 'slot',
      urlPath: '/parallel',
    });

    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({
          segmentName: 'parallel',
          urlPath: '/parallel',
          page: makeFile('ParallelHome'),
        }),
      ],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).toBeNull();
  });

  it('wraps slot root with error boundary from error.tsx', async () => {
    const slotNode = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/parallel',
      page: makeFile('SidebarHome'),
      error: makeFile('SidebarError'),
    });

    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({
          segmentName: 'parallel',
          urlPath: '/parallel',
          page: makeFile('ParallelHome'),
        }),
      ],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull();

    // The outermost wrapper should be TimberErrorBoundary (from error.tsx)
    const outer = result as { type: { name?: string }; props: Record<string, unknown> };
    expect(outer.type.name).toBe('TimberErrorBoundary');
    expect(outer.props.fallbackComponent).toBeDefined();
  });

  it('wraps slot child with error boundary from child error.tsx', async () => {
    const slotNode = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/parallel',
      page: makeFile('SidebarHome'),
      children: [
        makeSegment({
          segmentName: 'projects',
          segmentType: 'static',
          urlPath: '/parallel/projects',
          page: makeFile('SidebarProjects'),
          error: makeFile('SidebarProjectsError'),
        }),
      ],
    });

    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({ segmentName: 'parallel', urlPath: '/parallel' }),
        makeSegment({
          segmentName: 'projects',
          urlPath: '/parallel/projects',
          page: makeFile('ProjectsPage'),
        }),
      ],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull();

    // The outermost element should be TimberErrorBoundary from the child's error.tsx
    const outer = result as { type: { name?: string }; props: Record<string, unknown> };
    expect(outer.type.name).toBe('TimberErrorBoundary');
  });

  it('wraps slot root with layout.tsx', async () => {
    const slotNode = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/parallel',
      page: makeFile('SidebarHome'),
      layout: makeFile('SidebarLayout'),
    });

    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({
          segmentName: 'parallel',
          urlPath: '/parallel',
          page: makeFile('ParallelHome'),
        }),
      ],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull();

    // The outermost element should be the SidebarLayout
    const outer = result as { type: unknown; props: { children: unknown } };
    const sidebarLayout = ((await slotNode.layout!.load()) as Record<string, unknown>).default;
    expect(outer.type).toBe(sidebarLayout);
    // The children prop should contain the page element
    expect(outer.props.children).toBeDefined();
  });

  it('renders intercepting child when interception is active', async () => {
    // Slot @modal with an intercepting route (.)photo/[id] and a default.tsx
    const slotNode = makeSegment({
      segmentName: '@modal',
      segmentType: 'slot',
      urlPath: '/feed',
      default: makeFile('ModalDefault'),
      children: [
        makeSegment({
          segmentName: '(.)photo',
          segmentType: 'intercepting',
          urlPath: '/feed',
          interceptedSegmentName: 'photo',
          interceptionMarker: '(.)',
          children: [
            makeSegment({
              segmentName: '[id]',
              segmentType: 'dynamic',
              urlPath: '/feed',
              paramName: 'id',
              page: makeFile('InterceptedPhoto'),
            }),
          ],
        }),
      ],
    });

    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({
          segmentName: 'feed',
          urlPath: '/feed',
          page: makeFile('FeedPage'),
        }),
      ],
      params: {},
    };

    // With interception: renders the intercepting child's page
    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h,
      { targetPathname: '/feed/photo/123' }
    );
    expect(result).not.toBeNull();
    const interceptedPage = (
      await (
        slotNode.children as Array<{
          children: Array<{ page: { load: () => Promise<Record<string, unknown>> } }>;
        }>
      )[0].children[0].page.load()
    ).default;
    expect((result as { type: unknown }).type).toBe(interceptedPage);
  });

  it('falls back to default.tsx when no intercepting child matches', async () => {
    const slotNode = makeSegment({
      segmentName: '@modal',
      segmentType: 'slot',
      urlPath: '/feed',
      default: makeFile('ModalDefault'),
      children: [
        makeSegment({
          segmentName: '(.)photo',
          segmentType: 'intercepting',
          urlPath: '/feed',
          interceptedSegmentName: 'photo',
          interceptionMarker: '(.)',
          children: [
            makeSegment({
              segmentName: '[id]',
              segmentType: 'dynamic',
              urlPath: '/feed',
              paramName: 'id',
              page: makeFile('InterceptedPhoto'),
            }),
          ],
        }),
      ],
    });

    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({
          segmentName: 'feed',
          urlPath: '/feed',
          page: makeFile('FeedPage'),
        }),
      ],
      params: {},
    };

    // Without interception: normal match fails (no slot page at root), falls back to default
    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull();
    const defaultComp = ((await slotNode.default!.load()) as Record<string, unknown>).default;
    expect((result as { type: unknown }).type).toBe(defaultComp);
  });

  it('applies intermediate layout in slot child segment', async () => {
    const slotNode = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/parallel',
      page: makeFile('SidebarHome'),
      children: [
        makeSegment({
          segmentName: 'projects',
          segmentType: 'static',
          urlPath: '/parallel/projects',
          page: makeFile('SidebarProjects'),
          layout: makeFile('SidebarProjectsLayout'),
        }),
      ],
    });

    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }),
        makeSegment({ segmentName: 'parallel', urlPath: '/parallel' }),
        makeSegment({
          segmentName: 'projects',
          urlPath: '/parallel/projects',
          page: makeFile('ProjectsPage'),
        }),
      ],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull();

    // The outermost element should be the intermediate layout
    const outer = result as { type: unknown; props: { children: unknown } };
    const projectsLayout = (
      await (
        slotNode.children as Array<{ layout: { load: () => Promise<Record<string, unknown>> } }>
      )[0].layout.load()
    ).default;
    expect(outer.type).toBe(projectsLayout);
  });
});
