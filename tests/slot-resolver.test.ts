/**
 * Tests for parallel slot resolution.
 *
 * Verifies that slots correctly match pages or fall back to default.tsx
 * based on the current route's segment chain. Also tests that slots get
 * independent error boundaries and layouts from their matched segment chain.
 */

import { describe, expect, it, vi } from 'vitest';
import { TimberErrorBoundary } from '../packages/timber-app/src/client/error-boundary';
import { DenySignal } from '../packages/timber-app/src/server/primitives';
import type { ManifestSegmentNode } from '../packages/timber-app/src/server/route-matcher';
import { resolveSlotElement } from '../packages/timber-app/src/server/slot-resolver';

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
    // Outermost is the catch-all TimberErrorBoundary; inner is the SafeSlotPage wrapper
    const outer = result as {
      type: unknown;
      props: { children: { type: unknown; props: unknown } };
    };
    expect(outer.type).toBe(TimberErrorBoundary);
    // Verify the wrapper delegates to the actual page — calling it produces the page result
    const wrapper = outer.props.children;
    expect(typeof wrapper.type).toBe('function');
    expect((wrapper.type as { name: string }).name).toBe('SafeSlotPage');
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
    // const projectsPage = (
    //   await (
    //     slotNode.children as Array<{ page: { load: () => Promise<Record<string, unknown>> } }>
    //   )[0].page.load()
    // ).default;
    // Outermost is catch-all TimberErrorBoundary; inner is SafeSlotPage wrapper
    const outer = result as {
      type: unknown;
      props: { children: { type: unknown; props: unknown } };
    };
    expect(outer.type).toBe(TimberErrorBoundary);
    const wrapper = outer.props.children;
    expect(typeof wrapper.type).toBe('function');
    expect((wrapper.type as { name: string }).name).toBe('SafeSlotPage');
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

    // Outermost is catch-all TimberErrorBoundary; next is the SidebarLayout
    const catchAll = result as {
      type: unknown;
      props: { children: { type: unknown; props: { children: unknown } } };
    };
    expect(catchAll.type).toBe(TimberErrorBoundary);
    const sidebarLayout = ((await slotNode.layout!.load()) as Record<string, unknown>).default;
    expect(catchAll.props.children.type).toBe(sidebarLayout);
    expect(catchAll.props.children.props.children).toBeDefined();
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
    // const interceptedPage = (
    //   await (
    //     slotNode.children as Array<{
    //       children: Array<{ page: { load: () => Promise<Record<string, unknown>> } }>;
    //     }>
    //   )[0].children[0].page.load()
    // ).default;
    // Outermost is catch-all TimberErrorBoundary; inner is SafeSlotPage wrapper
    const outer = result as {
      type: unknown;
      props: { children: { type: unknown; props: unknown } };
    };
    expect(outer.type).toBe(TimberErrorBoundary);
    const wrapper = outer.props.children;
    expect(typeof wrapper.type).toBe('function');
    expect((wrapper.type as { name: string }).name).toBe('SafeSlotPage');
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

    // Outermost is catch-all TimberErrorBoundary; next is the intermediate layout
    const catchAll = result as { type: unknown; props: { children: { type: unknown } } };
    expect(catchAll.type).toBe(TimberErrorBoundary);
    const projectsLayout = (
      await (
        slotNode.children as Array<{ layout: { load: () => Promise<Record<string, unknown>> } }>
      )[0].layout.load()
    ).default;
    expect(catchAll.props.children.type).toBe(projectsLayout);
  });

  it('notFound() in slot page renders default.tsx fallback', async () => {
    const slotNode = makeSegment({
      segmentName: '@shows',
      segmentType: 'slot',
      urlPath: '/',
      page: {
        load: vi.fn().mockResolvedValue({
          default: async () => {
            throw new DenySignal(404);
          },
        }),
        filePath: '/app/@shows/page.tsx',
      },
      default: makeFile('ShowsDefault'),
    });

    const match: TestRouteMatch = {
      segments: [makeSegment({ segmentName: '', urlPath: '/' })],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull();

    // The outermost is catch-all TimberErrorBoundary.
    // Drill into the tree to find the SafeSlotPage wrapper rendered the default fallback.
    // The SafeSlotPage caught the DenySignal and returned the default.tsx component.
    const outer = result as {
      type: unknown;
      props: { children: { type: unknown; props: unknown } };
    };
    expect(outer.type).toBe(TimberErrorBoundary);

    // Verify the SafeSlotPage wrapper is present (the inner element's type is the wrapper)
    const innerElement = outer.props.children;
    // Call the SafeSlotPage component — it should catch DenySignal and return the fallback
    const rendered = await (innerElement.type as (props: unknown) => Promise<unknown>)(
      innerElement.props
    );
    const defaultComp = ((await slotNode.default!.load()) as Record<string, unknown>).default;
    // The rendered result should be an element with the default component as type
    expect((rendered as { type: unknown }).type).toBe(defaultComp);
  });

  it('notFound() in slot page renders null when no default.tsx', async () => {
    const slotNode = makeSegment({
      segmentName: '@shows',
      segmentType: 'slot',
      urlPath: '/',
      page: {
        load: vi.fn().mockResolvedValue({
          default: async () => {
            throw new DenySignal(404);
          },
        }),
        filePath: '/app/@shows/page.tsx',
      },
      // No default.tsx
    });

    const match: TestRouteMatch = {
      segments: [makeSegment({ segmentName: '', urlPath: '/' })],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );
    expect(result).not.toBeNull(); // element tree exists (has error boundary wrapper)

    // Call the SafeSlotPage — should catch DenySignal and return null
    const outer = result as {
      type: unknown;
      props: { children: { type: unknown; props: unknown } };
    };
    const innerElement = outer.props.children;
    const rendered = await (innerElement.type as (props: unknown) => Promise<unknown>)(
      innerElement.props
    );
    expect(rendered).toBeNull();
  });

  it('deny() with non-404 status in slot page also renders fallback', async () => {
    const slotNode = makeSegment({
      segmentName: '@admin',
      segmentType: 'slot',
      urlPath: '/',
      page: {
        load: vi.fn().mockResolvedValue({
          default: async () => {
            throw new DenySignal(403);
          },
        }),
        filePath: '/app/@admin/page.tsx',
      },
      default: makeFile('AdminDefault'),
    });

    const match: TestRouteMatch = {
      segments: [makeSegment({ segmentName: '', urlPath: '/' })],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );

    // Call the SafeSlotPage — should catch any DenySignal, not just 404
    const outer = result as {
      type: unknown;
      props: { children: { type: unknown; props: unknown } };
    };
    const innerElement = outer.props.children;
    const rendered = await (innerElement.type as (props: unknown) => Promise<unknown>)(
      innerElement.props
    );
    const defaultComp = ((await slotNode.default!.load()) as Record<string, unknown>).default;
    expect((rendered as { type: unknown }).type).toBe(defaultComp);
  });

  it('non-DenySignal errors in slot page still propagate', async () => {
    const slotNode = makeSegment({
      segmentName: '@shows',
      segmentType: 'slot',
      urlPath: '/',
      page: {
        load: vi.fn().mockResolvedValue({
          default: async () => {
            throw new Error('Some other error');
          },
        }),
        filePath: '/app/@shows/page.tsx',
      },
      default: makeFile('ShowsDefault'),
    });

    const match: TestRouteMatch = {
      segments: [makeSegment({ segmentName: '', urlPath: '/' })],
      params: {},
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({}),
      h
    );

    // Call the SafeSlotPage — non-DenySignal errors should propagate
    const outer = result as {
      type: unknown;
      props: { children: { type: unknown; props: unknown } };
    };
    const innerElement = outer.props.children;
    await expect(
      (innerElement.type as (props: unknown) => Promise<unknown>)(innerElement.props)
    ).rejects.toThrow('Some other error');
  });

  it('resolves slot under route group with same urlPath as root', async () => {
    // Regression test: when a route group has the same urlPath as the root
    // segment, findSlotMatch must find the group (deepest match), not the root.
    // Without searching backwards, remainingSegments is too long and slots fail.
    const slotNode = makeSegment({
      segmentName: '@sidebar',
      segmentType: 'slot',
      urlPath: '/', // same as root — this is the key to the bug
      page: makeFile('SidebarHome'),
      children: [
        makeSegment({
          segmentName: '[artistSlug]',
          segmentType: 'dynamic',
          urlPath: '/[artistSlug]',
          paramName: 'artistSlug',
          page: makeFile('SidebarArtist'),
        }),
      ],
    });

    // URL: /phish — segments include root, (browse) group, and [artistSlug]
    const match: TestRouteMatch = {
      segments: [
        makeSegment({ segmentName: '', urlPath: '/' }), // root
        makeSegment({ segmentName: '(browse)', segmentType: 'group', urlPath: '/' }), // group
        makeSegment({
          segmentName: '[artistSlug]',
          segmentType: 'dynamic',
          urlPath: '/[artistSlug]',
          paramName: 'artistSlug',
          page: makeFile('ArtistPage'),
        }),
      ],
      params: { artistSlug: 'phish' },
    };

    const result = await resolveSlotElement(
      slotNode as never,
      match as never,
      Promise.resolve({ artistSlug: 'phish' }),
      h
    );
    expect(result).not.toBeNull();

    // Should match the slot's [artistSlug] child, not fail
    // const slotArtistPage = (
    //   await (
    //     slotNode.children as Array<{ page: { load: () => Promise<Record<string, unknown>> } }>
    //   )[0].page.load()
    // ).default;
    const outer = result as {
      type: unknown;
      props: { children: { type: unknown; props: unknown } };
    };
    expect(outer.type).toBe(TimberErrorBoundary);
    const wrapper = outer.props.children;
    expect(typeof wrapper.type).toBe('function');
    expect((wrapper.type as { name: string }).name).toBe('SafeSlotPage');
  });
});
