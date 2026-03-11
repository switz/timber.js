/**
 * Tests for the search-params runtime registry and route-scoped useQueryStates.
 *
 * Covers:
 * - registerSearchParams + getSearchParams round-trip
 * - useQueryStates('/route') resolves from registry
 * - Unknown route throws descriptive error
 * - search-params.ts changes trigger manifest regen (via route-watching)
 *
 * Design ref: design/23-search-params.md §"Runtime: Registration at Route Load"
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { createElement, type ReactNode } from 'react';
import { createSearchParams } from '@timber/app/search-params';
import {
  registerSearchParams,
  getSearchParams,
} from '../packages/timber-app/src/search-params/registry.js';
import { useQueryStates } from '../packages/timber-app/src/client/use-query-states.js';
import { timberRouting } from '../packages/timber-app/src/plugins/routing.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';
import { vi } from 'vitest';

// ─── Codecs ─────────────────────────────────────────────────────

const pageCodec = {
  parse: (v: string | string[] | undefined) => (typeof v === 'string' ? Number(v) : 1),
  serialize: (v: number) => String(v),
};

const qCodec = {
  parse: (v: string | string[] | undefined): string | null => (typeof v === 'string' ? v : null),
  serialize: (v: string | null): string | null => v,
};

// ─── Helpers ─────────────────────────────────────────────────────

function createWrapper(searchParams?: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(
      NuqsTestingAdapter,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { searchParams: searchParams ?? '', hasMemory: true } as any,
      children
    );
}

// ─── Registry unit tests ─────────────────────────────────────────

describe('search params registry', () => {
  // Clear the registry between tests by registering and then reading
  // (registry is a module-level Map, so we need to be careful)

  it('register and retrieve', () => {
    const def = createSearchParams({ page: pageCodec, q: qCodec });
    registerSearchParams('/products', def);

    const retrieved = getSearchParams('/products');
    expect(retrieved).toBe(def);
  });

  it('returns undefined for unregistered route', () => {
    const retrieved = getSearchParams('/nonexistent-route-' + Date.now());
    expect(retrieved).toBeUndefined();
  });

  it('overwrites previous registration for same route', () => {
    const def1 = createSearchParams({ page: pageCodec });
    const def2 = createSearchParams({ q: qCodec });

    registerSearchParams('/overwrite-test', def1);
    registerSearchParams('/overwrite-test', def2);

    expect(getSearchParams('/overwrite-test')).toBe(def2);
  });
});

// ─── useQueryStates route-string overload ────────────────────────

describe('useQueryStates route-string overload', () => {
  it('hook resolves route', () => {
    const def = createSearchParams({ page: pageCodec, q: qCodec });
    registerSearchParams('/products', def);

    const { result } = renderHook(() => useQueryStates('/products'), {
      wrapper: createWrapper('?page=3&q=boots'),
    });

    const [params] = result.current;
    expect(params.page).toBe(3);
    expect(params.q).toBe('boots');
  });

  it('hook resolves route with urlKeys', () => {
    const def = createSearchParams(
      { search: qCodec, page: pageCodec },
      { urlKeys: { search: 'q' } }
    );
    registerSearchParams('/search-page', def);

    const { result } = renderHook(() => useQueryStates('/search-page'), {
      wrapper: createWrapper('?q=shoes&page=2'),
    });

    const [params] = result.current;
    expect(params.search).toBe('shoes');
    expect(params.page).toBe(2);
  });

  it('unknown route error', () => {
    // Use a route that won't have been registered
    const uniqueRoute = '/unknown-route-' + Date.now();

    expect(() => {
      renderHook(() => useQueryStates(uniqueRoute), {
        wrapper: createWrapper(''),
      });
    }).toThrow(`useQueryStates('${uniqueRoute}')`);
  });

  it('error message suggests explicit import for cross-route usage', () => {
    const uniqueRoute = '/cross-route-' + Date.now();

    expect(() => {
      renderHook(() => useQueryStates(uniqueRoute), {
        wrapper: createWrapper(''),
      });
    }).toThrow('import the definition explicitly');
  });
});

// ─── File watcher: search-params.ts triggers manifest regen ──────

const TMP_DIR = join(import.meta.dirname, '.tmp-search-params-registry-test');
const RESOLVED_ID = '\0virtual:timber-route-manifest';

function appDir(...segments: string[]): string {
  return join(TMP_DIR, 'app', ...segments);
}

function createFile(path: string, content = 'export default function() { return null }'): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function createApp(files: Record<string, string>): string {
  const root = appDir();
  mkdirSync(root, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    createFile(join(root, filePath), content);
  }
  return root;
}

function createPluginContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    config: { output: 'server', ...overrides.config },
    routeTree: null,
    appDir: appDir(),
    root: TMP_DIR,
    dev: false,
    buildManifest: null,
    ...overrides,
  };
}

function createMockServer() {
  const listeners: Record<string, Array<(path: string) => void>> = {};

  const moduleGraph = {
    getModuleById: vi.fn().mockReturnValue({ id: RESOLVED_ID }),
    invalidateModule: vi.fn(),
  };

  const server = {
    watcher: {
      on: vi.fn((event: string, cb: (path: string) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        return server.watcher;
      }),
      add: vi.fn(),
    },
    environments: {
      rsc: { moduleGraph },
      ssr: { moduleGraph },
      client: { moduleGraph },
    },
    hot: {
      send: vi.fn(),
    },
  };

  function emit(event: string, filePath: string) {
    for (const cb of listeners[event] ?? []) {
      cb(filePath);
    }
  }

  return { server, emit, moduleGraph };
}

function setupPlugin(files: Record<string, string>) {
  const root = createApp(files);
  const ctx = createPluginContext({ appDir: root });
  const plugin = timberRouting(ctx);
  const { server, emit, moduleGraph } = createMockServer();

  const configureServer = plugin.configureServer as (s: unknown) => void;
  configureServer.call({}, server);

  const load = plugin.load as (id: string) => string | null;
  const getManifest = () => load.call({}, RESOLVED_ID)!;

  return { ctx, plugin, server, emit, moduleGraph, root, getManifest };
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  // Wait for fire-and-forget codegen writes (writeCodegen) to settle before cleanup
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('file watcher', () => {
  it('search-params.ts changes trigger manifest regen', () => {
    const { emit, root, server, getManifest } = setupPlugin({
      'page.tsx': 'export default function Home() {}',
      'products/page.tsx': 'export default function Products() {}',
    });

    server.hot.send.mockClear();

    // Verify no searchParams in manifest initially
    const before = getManifest();
    expect(before).not.toContain('searchParams');

    // Add search-params.ts and trigger file watcher
    createFile(
      join(root, 'products/search-params.ts'),
      'export default createSearchParams({ page: pageCodec })'
    );
    emit('add', join(root, 'products/search-params.ts'));

    // Manifest should now include searchParams
    const after = getManifest();
    expect(after).toContain('searchParams');
    expect(after).toContain(join(root, 'products/search-params.ts'));

    // HMR full-reload should have been sent
    expect(server.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('removing search-params.ts triggers manifest regen', () => {
    const { emit, root, server, getManifest } = setupPlugin({
      'page.tsx': 'export default function Home() {}',
      'products/page.tsx': 'export default function Products() {}',
      'products/search-params.ts': 'export default createSearchParams({})',
    });

    // Verify searchParams exists initially
    const before = getManifest();
    expect(before).toContain('searchParams');

    server.hot.send.mockClear();

    // Remove search-params.ts
    unlinkSync(join(root, 'products/search-params.ts'));
    emit('unlink', join(root, 'products/search-params.ts'));

    // Manifest should no longer include searchParams for products
    const after = getManifest();
    expect(after).not.toContain(join(root, 'products/search-params.ts'));
    expect(server.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('scanner detects search-params.ts and populates SegmentNode', () => {
    const { ctx } = setupPlugin({
      'page.tsx': 'export default function Home() {}',
      'products/page.tsx': 'export default function Products() {}',
      'products/search-params.ts': 'export default createSearchParams({})',
    });

    const products = ctx.routeTree!.root.children.find((c) => c.segmentName === 'products');
    expect(products).toBeDefined();
    expect(products!.searchParams).toBeDefined();
    expect(products!.searchParams!.filePath).toContain('search-params.ts');
    expect(products!.searchParams!.extension).toBe('ts');
  });
});
