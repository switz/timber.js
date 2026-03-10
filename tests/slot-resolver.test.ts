/**
 * Tests for parallel slot resolution.
 *
 * Verifies that slots correctly match pages or fall back to default.tsx
 * based on the current route's segment chain.
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
});
