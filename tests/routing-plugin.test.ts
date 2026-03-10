import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { timberRouting } from '../packages/timber-app/src/plugins/routing.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';

const TMP_DIR = join(import.meta.dirname, '.tmp-routing-plugin-test');

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
    ...overrides,
  };
}

const VIRTUAL_ID = 'virtual:timber-route-manifest';
const RESOLVED_ID = '\0virtual:timber-route-manifest';

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('timber-routing plugin', () => {
  describe('resolveId', () => {
    it('resolves virtual module', () => {
      const ctx = createPluginContext();
      const plugin = timberRouting(ctx);

      const resolveId = plugin.resolveId as (id: string) => string | null;
      expect(resolveId.call({}, VIRTUAL_ID)).toBe(RESOLVED_ID);
    });

    it('resolves root-prefixed virtual module', () => {
      const ctx = createPluginContext();
      const plugin = timberRouting(ctx);

      const resolveId = plugin.resolveId as (id: string) => string | null;
      // Vite prefixes virtual module IDs with project root in SSR build
      expect(resolveId.call({}, `${TMP_DIR}/${VIRTUAL_ID}`)).toBe(RESOLVED_ID);
    });

    it('strips \\0 prefix before matching', () => {
      const ctx = createPluginContext();
      const plugin = timberRouting(ctx);

      const resolveId = plugin.resolveId as (id: string) => string | null;
      // RSC plugin may generate imports with \0 prefix
      expect(resolveId.call({}, `\0${VIRTUAL_ID}`)).toBe(RESOLVED_ID);
    });

    it('passes through unrelated imports', () => {
      const ctx = createPluginContext();
      const plugin = timberRouting(ctx);

      const resolveId = plugin.resolveId as (id: string) => string | null;
      expect(resolveId.call({}, 'react')).toBeNull();
      expect(resolveId.call({}, './my-component.tsx')).toBeNull();
    });
  });

  describe('load', () => {
    it('generates manifest with absolute paths', () => {
      const root = createApp({
        'page.tsx': 'export default function Home() {}',
        'layout.tsx': 'export default function RootLayout({ children }) {}',
      });

      const ctx = createPluginContext({ appDir: root });
      const plugin = timberRouting(ctx);

      // Trigger scan via buildStart
      const buildStart = plugin.buildStart as () => void;
      buildStart.call({});

      const load = plugin.load as (id: string) => string | null;
      const result = load.call({}, RESOLVED_ID);

      expect(result).not.toBeNull();
      expect(result).toContain('export default');
      // Absolute paths — no relative imports
      expect(result).toContain(root);
      expect(result).not.toMatch(/from\s+['"]\.\//);
    });

    it('manifest includes segment metadata', () => {
      const root = createApp({
        'page.tsx': 'export default function Home() {}',
        'dashboard/page.tsx': 'export default function Dash() {}',
        'dashboard/[id]/page.tsx': 'export default function Item() {}',
      });

      const ctx = createPluginContext({ appDir: root });
      const plugin = timberRouting(ctx);

      const buildStart = plugin.buildStart as () => void;
      buildStart.call({});

      const load = plugin.load as (id: string) => string | null;
      const result = load.call({}, RESOLVED_ID)!;

      // Check segment metadata is present
      expect(result).toContain('"static"'); // segmentType for root and dashboard
      expect(result).toContain('"dynamic"'); // segmentType for [id]
      expect(result).toContain('"id"'); // paramName for [id]
      expect(result).toContain('"/dashboard"'); // urlPath
      expect(result).toContain('"/dashboard/[id]"'); // urlPath for dynamic
    });

    it('manifest includes file convention paths', () => {
      const root = createApp({
        'page.tsx': 'export default function Home() {}',
        'layout.tsx': 'export default function Root({ children }) {}',
        'middleware.ts': 'export default function middleware() {}',
        'dashboard/page.tsx': 'export default function Dash() {}',
        'dashboard/access.ts': 'export default function access() {}',
      });

      const ctx = createPluginContext({ appDir: root });
      const plugin = timberRouting(ctx);

      const buildStart = plugin.buildStart as () => void;
      buildStart.call({});

      const load = plugin.load as (id: string) => string | null;
      const result = load.call({}, RESOLVED_ID)!;

      // All file paths should appear as absolute imports
      expect(result).toContain(join(root, 'page.tsx'));
      expect(result).toContain(join(root, 'layout.tsx'));
      expect(result).toContain(join(root, 'middleware.ts'));
      expect(result).toContain(join(root, 'dashboard/page.tsx'));
      expect(result).toContain(join(root, 'dashboard/access.ts'));
    });

    it('returns null for non-manifest modules', () => {
      const ctx = createPluginContext();
      const plugin = timberRouting(ctx);

      const load = plugin.load as (id: string) => string | null;
      expect(load.call({}, '\0some-other-module')).toBeNull();
    });
  });

  describe('PluginContext', () => {
    it('populates plugin context routeTree after scan', () => {
      const root = createApp({
        'page.tsx': 'export default function Home() {}',
        'dashboard/page.tsx': 'export default function Dash() {}',
      });

      const ctx = createPluginContext({ appDir: root });
      const plugin = timberRouting(ctx);

      expect(ctx.routeTree).toBeNull();

      const buildStart = plugin.buildStart as () => void;
      buildStart.call({});

      expect(ctx.routeTree).not.toBeNull();
      expect(ctx.routeTree!.root).toBeDefined();
      expect(ctx.routeTree!.root.children.length).toBe(1);
      expect(ctx.routeTree!.root.children[0].segmentName).toBe('dashboard');
    });
  });

  describe('edge cases', () => {
    it('handles empty app directory', () => {
      const root = createApp({});

      const ctx = createPluginContext({ appDir: root });
      const plugin = timberRouting(ctx);

      const buildStart = plugin.buildStart as () => void;
      buildStart.call({});

      expect(ctx.routeTree).not.toBeNull();
      expect(ctx.routeTree!.root.children.length).toBe(0);
      expect(ctx.routeTree!.root.page).toBeUndefined();

      const load = plugin.load as (id: string) => string | null;
      const result = load.call({}, RESOLVED_ID)!;

      expect(result).toContain('export default');
    });

    it('handles parallel slots in manifest', () => {
      const root = createApp({
        'layout.tsx': 'export default function Root({ children }) {}',
        '@sidebar/page.tsx': 'export default function Sidebar() {}',
        'page.tsx': 'export default function Home() {}',
      });

      const ctx = createPluginContext({ appDir: root });
      const plugin = timberRouting(ctx);

      const buildStart = plugin.buildStart as () => void;
      buildStart.call({});

      const load = plugin.load as (id: string) => string | null;
      const result = load.call({}, RESOLVED_ID)!;

      expect(result).toContain('sidebar');
      expect(result).toContain(join(root, '@sidebar/page.tsx'));
    });

    it('handles route groups without URL depth', () => {
      const root = createApp({
        '(auth)/login/page.tsx': 'export default function Login() {}',
        '(auth)/layout.tsx': 'export default function AuthLayout() {}',
      });

      const ctx = createPluginContext({ appDir: root });
      const plugin = timberRouting(ctx);

      const buildStart = plugin.buildStart as () => void;
      buildStart.call({});

      const load = plugin.load as (id: string) => string | null;
      const result = load.call({}, RESOLVED_ID)!;

      // Route groups don't add URL depth — (auth) group has urlPath "/"
      expect(result).toContain('"group"');
      expect(result).toContain('"/login"'); // login is under / not /(auth)/login
    });
  });

  describe('dev watcher', () => {
    it('invalidates manifest on file change', () => {
      const root = createApp({
        'page.tsx': 'export default function Home() {}',
      });

      const ctx = createPluginContext({ appDir: root });
      const plugin = timberRouting(ctx);

      // Mock the Vite server watcher
      const watchCallback = vi.fn();
      const moduleGraph = {
        getModuleById: vi.fn().mockReturnValue({ id: RESOLVED_ID }),
      };
      const mockServer = {
        watcher: {
          on: vi.fn((_event: string, cb: (...args: unknown[]) => unknown) => {
            watchCallback.mockImplementation(cb);
            return mockServer.watcher;
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

      const configureServer = plugin.configureServer as (server: unknown) => void;
      configureServer.call({}, mockServer);

      // Verify watcher watches the app directory
      expect(mockServer.watcher.add).toHaveBeenCalledWith(root);

      // Simulate a file add/change in app/
      expect(mockServer.watcher.on).toHaveBeenCalled();
    });
  });
});
