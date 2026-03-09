import { describe, it, expect } from 'vitest';
import {
  buildElementTree,
  type TreeBuilderConfig,
  type LoadedModule,
  type CreateElement,
} from '../packages/timber-app/src/server/tree-builder';
import type { SegmentNode, RouteFile } from '../packages/timber-app/src/routing/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal route file for testing. */
function makeRouteFile(filePath: string): RouteFile {
  return { filePath, extension: 'tsx' };
}

/** Create a minimal segment node. */
function makeSegment(overrides?: Partial<SegmentNode>): SegmentNode {
  return {
    segmentName: '',
    segmentType: 'static',
    urlPath: '/',
    children: [],
    slots: new Map(),
    ...overrides,
  };
}

/**
 * Simple createElement that returns a plain object describing the element.
 * This avoids depending on React in unit tests.
 */
const mockCreateElement: CreateElement = (type, props, ...children) => ({
  type,
  props: { ...props, children: children.length > 0 ? children : props?.children },
});

/** Default module loader that returns modules keyed by file path. */
function makeModuleLoader(modules: Record<string, LoadedModule>) {
  return (file: RouteFile): LoadedModule => {
    const mod = modules[file.filePath];
    if (!mod) throw new Error(`No module registered for ${file.filePath}`);
    return mod;
  };
}

/** Default config with sensible defaults. */
function makeConfig(overrides?: Partial<TreeBuilderConfig>): TreeBuilderConfig {
  return {
    segments: [],
    params: {},
    searchParams: new URLSearchParams(),
    loadModule: () => ({}),
    createElement: mockCreateElement,
    ...overrides,
  };
}

// Stub components for testing
function PageComponent(props: unknown) {
  return { page: true, props };
}
function LayoutComponent(props: unknown) {
  return { layout: true, props };
}
function RootLayoutComponent(props: unknown) {
  return { rootLayout: true, props };
}
function ErrorComponent(props: unknown) {
  return { error: true, props };
}
function NotFoundComponent(props: unknown) {
  return { notFound: true, props };
}
function AccessFn(ctx: unknown) {
  return ctx;
}
function SlotPageComponent(props: unknown) {
  return { slotPage: true, props };
}
function SlotDeniedComponent(props: unknown) {
  return { slotDenied: true, props };
}
function SlotDefaultComponent(props: unknown) {
  return { slotDefault: true, props };
}
function SlotAccessFn(ctx: unknown) {
  return ctx;
}

// ─── Bottom-Up Tree Construction ──────────────────────────────────────────────

describe('bottom-up tree construction', () => {
  it('builds a tree with page only', async () => {
    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        page: makeRouteFile('app/page.tsx'),
      }),
    ];

    const result = await buildElementTree(
      makeConfig({
        segments,
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
        }),
      })
    );

    expect(result.isApiRoute).toBe(false);
    expect(result.tree).toBeDefined();
    expect(result.tree.type).toBe(PageComponent);
  });

  it('wraps page in layout', async () => {
    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        page: makeRouteFile('app/page.tsx'),
        layout: makeRouteFile('app/layout.tsx'),
      }),
    ];

    const result = await buildElementTree(
      makeConfig({
        segments,
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
          'app/layout.tsx': { default: LayoutComponent },
        }),
      })
    );

    // Outermost element is the layout
    expect(result.tree.type).toBe(LayoutComponent);
    // Children should contain the page
    expect(result.tree.props.children.type).toBe(PageComponent);
  });

  it('builds multi-segment tree bottom-up', async () => {
    const rootSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      layout: makeRouteFile('app/layout.tsx'),
    });
    const dashSegment = makeSegment({
      segmentName: 'dashboard',
      urlPath: '/dashboard',
      page: makeRouteFile('app/dashboard/page.tsx'),
      layout: makeRouteFile('app/dashboard/layout.tsx'),
    });

    const result = await buildElementTree(
      makeConfig({
        segments: [rootSegment, dashSegment],
        loadModule: makeModuleLoader({
          'app/layout.tsx': { default: RootLayoutComponent },
          'app/dashboard/page.tsx': { default: PageComponent },
          'app/dashboard/layout.tsx': { default: LayoutComponent },
        }),
      })
    );

    // Root layout wraps everything
    expect(result.tree.type).toBe(RootLayoutComponent);
    // Dashboard layout wraps the page
    const innerLayout = result.tree.props.children;
    expect(innerLayout.type).toBe(LayoutComponent);
    // Page is the innermost
    expect(innerLayout.props.children.type).toBe(PageComponent);
  });
});

// ─── Error Boundary Wrapping ──────────────────────────────────────────────────

describe('error boundary wrapping', () => {
  it('wraps page in error.tsx boundary', async () => {
    const segments = [
      makeSegment({
        page: makeRouteFile('app/page.tsx'),
        error: makeRouteFile('app/error.tsx'),
      }),
    ];

    const result = await buildElementTree(
      makeConfig({
        segments,
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
          'app/error.tsx': { default: ErrorComponent },
        }),
      })
    );

    // error boundary should wrap the page
    expect(result.tree.type).toBe('timber:error-boundary');
    expect(result.tree.props.fallbackComponent).toBe(ErrorComponent);
    expect(result.tree.props.children.type).toBe(PageComponent);
  });

  it('wraps with status-code files (4xx, 5xx)', async () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('404', makeRouteFile('app/404.tsx'));
    statusFiles.set('4xx', makeRouteFile('app/4xx.tsx'));

    const segments = [
      makeSegment({
        page: makeRouteFile('app/page.tsx'),
        statusFiles,
      }),
    ];

    const result = await buildElementTree(
      makeConfig({
        segments,
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
          'app/404.tsx': { default: NotFoundComponent },
          'app/4xx.tsx': { default: ErrorComponent },
        }),
      })
    );

    // Specific status (404) should be innermost, then category (4xx)
    // The tree should be: 4xx boundary → 404 boundary → page
    // (outer wraps inner, so 404 is checked first at runtime)
    expect(result.tree.type).toBe('timber:error-boundary');
  });

  it('wraps with error.tsx outside status-code boundaries', async () => {
    const statusFiles = new Map<string, RouteFile>();
    statusFiles.set('5xx', makeRouteFile('app/5xx.tsx'));

    const segments = [
      makeSegment({
        page: makeRouteFile('app/page.tsx'),
        error: makeRouteFile('app/error.tsx'),
        statusFiles,
      }),
    ];

    const result = await buildElementTree(
      makeConfig({
        segments,
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
          'app/error.tsx': { default: ErrorComponent },
          'app/5xx.tsx': { default: NotFoundComponent },
        }),
      })
    );

    // error.tsx is outermost boundary (catches anything not matched by status files)
    expect(result.tree.type).toBe('timber:error-boundary');
    expect(result.tree.props.fallbackComponent).toBe(ErrorComponent);
  });
});

// ─── Access Gate Injection ────────────────────────────────────────────────────

describe('access gate injection', () => {
  it('wraps segment with AccessGate when access.ts exists', async () => {
    const segments = [
      makeSegment({
        page: makeRouteFile('app/page.tsx'),
        access: makeRouteFile('app/access.ts'),
        layout: makeRouteFile('app/layout.tsx'),
      }),
    ];

    const result = await buildElementTree(
      makeConfig({
        segments,
        params: { id: '42' },
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
          'app/access.ts': { default: AccessFn },
          'app/layout.tsx': { default: LayoutComponent },
        }),
      })
    );

    // Layout wraps AccessGate wraps page
    expect(result.tree.type).toBe(LayoutComponent);
    const accessGate = result.tree.props.children;
    expect(accessGate.type).toBe('timber:access-gate');
    expect(accessGate.props.accessFn).toBe(AccessFn);
    expect(accessGate.props.params).toEqual({ id: '42' });
  });

  it('injects AccessGate at each segment level', async () => {
    const rootSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      access: makeRouteFile('app/access.ts'),
      layout: makeRouteFile('app/layout.tsx'),
    });
    const authSegment = makeSegment({
      segmentName: '(auth)',
      segmentType: 'group',
      urlPath: '/',
      access: makeRouteFile('app/(auth)/access.ts'),
      layout: makeRouteFile('app/(auth)/layout.tsx'),
      page: makeRouteFile('app/(auth)/page.tsx'),
    });

    const result = await buildElementTree(
      makeConfig({
        segments: [rootSegment, authSegment],
        loadModule: makeModuleLoader({
          'app/access.ts': { default: AccessFn },
          'app/layout.tsx': { default: RootLayoutComponent },
          'app/(auth)/access.ts': { default: AccessFn },
          'app/(auth)/layout.tsx': { default: LayoutComponent },
          'app/(auth)/page.tsx': { default: PageComponent },
        }),
      })
    );

    // Root: Layout → AccessGate → inner
    expect(result.tree.type).toBe(RootLayoutComponent);
    const rootGate = result.tree.props.children;
    expect(rootGate.type).toBe('timber:access-gate');

    // Auth: Layout → AccessGate → page
    const authLayout = rootGate.props.children;
    expect(authLayout.type).toBe(LayoutComponent);
    const authGate = authLayout.props.children;
    expect(authGate.type).toBe('timber:access-gate');
  });
});

// ─── Parallel Slot Composition ────────────────────────────────────────────────

describe('parallel slot composition', () => {
  it('passes slots as named props to layout', async () => {
    const adminSlot = makeSegment({
      segmentName: '@admin',
      segmentType: 'slot',
      urlPath: '/',
      page: makeRouteFile('app/@admin/page.tsx'),
    });

    const rootSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      page: makeRouteFile('app/page.tsx'),
      layout: makeRouteFile('app/layout.tsx'),
      slots: new Map([['admin', adminSlot]]),
    });

    const result = await buildElementTree(
      makeConfig({
        segments: [rootSegment],
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
          'app/layout.tsx': { default: LayoutComponent },
          'app/@admin/page.tsx': { default: SlotPageComponent },
        }),
      })
    );

    // Layout should receive 'admin' slot as a prop
    expect(result.tree.type).toBe(LayoutComponent);
    expect(result.tree.props.admin).toBeDefined();
    expect(result.tree.props.admin.type).toBe(SlotPageComponent);
  });

  it('wraps slot with SlotAccessGate when slot has access.ts', async () => {
    const adminSlot = makeSegment({
      segmentName: '@admin',
      segmentType: 'slot',
      urlPath: '/',
      page: makeRouteFile('app/@admin/page.tsx'),
      access: makeRouteFile('app/@admin/access.ts'),
      denied: makeRouteFile('app/@admin/denied.tsx'),
    });

    const rootSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      page: makeRouteFile('app/page.tsx'),
      layout: makeRouteFile('app/layout.tsx'),
      slots: new Map([['admin', adminSlot]]),
    });

    const result = await buildElementTree(
      makeConfig({
        segments: [rootSegment],
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
          'app/layout.tsx': { default: LayoutComponent },
          'app/@admin/page.tsx': { default: SlotPageComponent },
          'app/@admin/access.ts': { default: SlotAccessFn },
          'app/@admin/denied.tsx': { default: SlotDeniedComponent },
        }),
      })
    );

    // Layout's admin prop should be a SlotAccessGate
    const adminSlotElement = result.tree.props.admin;
    expect(adminSlotElement.type).toBe('timber:slot-access-gate');
    expect(adminSlotElement.props.accessFn).toBe(SlotAccessFn);
    expect(adminSlotElement.props.deniedFallback).toBeDefined();
  });

  it('slot with no page renders default.tsx', async () => {
    const feedSlot = makeSegment({
      segmentName: '@feed',
      segmentType: 'slot',
      urlPath: '/',
      default: makeRouteFile('app/@feed/default.tsx'),
    });

    const rootSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      page: makeRouteFile('app/page.tsx'),
      layout: makeRouteFile('app/layout.tsx'),
      slots: new Map([['feed', feedSlot]]),
    });

    const result = await buildElementTree(
      makeConfig({
        segments: [rootSegment],
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
          'app/layout.tsx': { default: LayoutComponent },
          'app/@feed/default.tsx': { default: SlotDefaultComponent },
        }),
      })
    );

    expect(result.tree.props.feed.type).toBe(SlotDefaultComponent);
  });

  it('slot with no page and no default renders null', async () => {
    const emptySlot = makeSegment({
      segmentName: '@empty',
      segmentType: 'slot',
      urlPath: '/',
    });

    const rootSegment = makeSegment({
      segmentName: '',
      urlPath: '/',
      page: makeRouteFile('app/page.tsx'),
      layout: makeRouteFile('app/layout.tsx'),
      slots: new Map([['empty', emptySlot]]),
    });

    const result = await buildElementTree(
      makeConfig({
        segments: [rootSegment],
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
          'app/layout.tsx': { default: LayoutComponent },
        }),
      })
    );

    expect(result.tree.props.empty).toBeNull();
  });
});

// ─── Single Render Call ───────────────────────────────────────────────────────

describe('single render call', () => {
  it('returns a single unified tree, not separate trees', async () => {
    const segments = [
      makeSegment({
        segmentName: '',
        urlPath: '/',
        layout: makeRouteFile('app/layout.tsx'),
      }),
      makeSegment({
        segmentName: 'dashboard',
        urlPath: '/dashboard',
        layout: makeRouteFile('app/dashboard/layout.tsx'),
        page: makeRouteFile('app/dashboard/page.tsx'),
      }),
    ];

    const result = await buildElementTree(
      makeConfig({
        segments,
        loadModule: makeModuleLoader({
          'app/layout.tsx': { default: RootLayoutComponent },
          'app/dashboard/layout.tsx': { default: LayoutComponent },
          'app/dashboard/page.tsx': { default: PageComponent },
        }),
      })
    );

    // A single tree with nested structure
    expect(result.tree).toBeDefined();
    expect(result.tree.type).toBe(RootLayoutComponent);
    // Not an array, not multiple trees
    expect(Array.isArray(result.tree)).toBe(false);
  });

  it('API routes (route.ts) return isApiRoute: true and null tree', async () => {
    const segments = [
      makeSegment({
        segmentName: 'api',
        urlPath: '/api',
        route: makeRouteFile('app/api/route.ts'),
      }),
    ];

    const result = await buildElementTree(
      makeConfig({
        segments,
        loadModule: makeModuleLoader({
          'app/api/route.ts': { default: () => {}, GET: () => new Response('ok') },
        }),
      })
    );

    expect(result.isApiRoute).toBe(true);
    expect(result.tree).toBeNull();
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('throws on empty segment chain', async () => {
    await expect(buildElementTree(makeConfig({ segments: [] }))).rejects.toThrow(
      'empty segment chain'
    );
  });

  it('throws when leaf has no page.tsx and no route.ts', async () => {
    const segments = [makeSegment({ segmentName: '', urlPath: '/' })];

    await expect(buildElementTree(makeConfig({ segments }))).rejects.toThrow(
      'No page component found'
    );
  });

  it('passes params and searchParams to page component', async () => {
    const params = { id: '42', slug: 'test' };
    const searchParams = new URLSearchParams('q=hello');

    const segments = [
      makeSegment({
        page: makeRouteFile('app/page.tsx'),
      }),
    ];

    const result = await buildElementTree(
      makeConfig({
        segments,
        params,
        searchParams,
        loadModule: makeModuleLoader({
          'app/page.tsx': { default: PageComponent },
        }),
      })
    );

    expect(result.tree.props.params).toEqual(params);
    expect(result.tree.props.searchParams).toBe(searchParams);
  });
});
