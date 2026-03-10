/**
 * Tests for route tree file watching in the timber-routing plugin.
 *
 * Verifies that adding/removing route-significant files triggers
 * manifest regeneration and module invalidation, while non-route
 * files are ignored.
 *
 * Design refs: 18-build-system.md §Route Tree Watching,
 *              21-dev-server.md §Route Tree Watching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { timberRouting } from '../packages/timber-app/src/plugins/routing.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';

const TMP_DIR = join(import.meta.dirname, '.tmp-route-watching-test');
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
    ...overrides,
  };
}

/**
 * Create a mock ViteDevServer with watcher event capture.
 *
 * Returns the mock server and a function to simulate file events.
 */
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

/**
 * Set up the plugin with configureServer and return helpers.
 */
function setupPlugin(files: Record<string, string>) {
  const root = createApp(files);
  const ctx = createPluginContext({ appDir: root });
  const plugin = timberRouting(ctx);
  const { server, emit, moduleGraph } = createMockServer();

  // Wire up configureServer (triggers initial scan)
  const configureServer = plugin.configureServer as (s: unknown) => void;
  configureServer.call({}, server);

  const load = plugin.load as (id: string) => string | null;
  const getManifest = () => load.call({}, RESOLVED_ID)!;

  return { ctx, plugin, server, emit, moduleGraph, root, getManifest };
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('route tree file watching', () => {
  describe('adding route files regenerates manifest', () => {
    it('adding a new page.tsx regenerates route manifest', () => {
      const { emit, root, getManifest, server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      // Verify initial state: no dashboard route
      const before = getManifest();
      expect(before).not.toContain('dashboard');

      // Create the new page file on disk
      createFile(join(root, 'dashboard/page.tsx'), 'export default function Dash() {}');

      // Simulate the watcher event
      emit('add', join(root, 'dashboard/page.tsx'));

      // Verify manifest regenerated with new route
      const after = getManifest();
      expect(after).toContain('dashboard');
      expect(after).toContain(join(root, 'dashboard/page.tsx'));

      // Verify HMR full-reload was sent
      expect(server.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });
    });

    it('adding middleware.ts regenerates manifest', () => {
      const { emit, root, getManifest, server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
        'dashboard/page.tsx': 'export default function Dash() {}',
      });

      // Verify no middleware initially
      const before = getManifest();
      expect(before).not.toContain('middleware');

      // Add middleware on disk and trigger event
      createFile(join(root, 'dashboard/middleware.ts'), 'export default function middleware() {}');
      emit('add', join(root, 'dashboard/middleware.ts'));

      // Verify manifest now includes middleware
      const after = getManifest();
      expect(after).toContain('middleware');
      expect(after).toContain(join(root, 'dashboard/middleware.ts'));
      expect(server.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });
    });

    it('adding access.ts regenerates manifest', () => {
      const { emit, root, getManifest, server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
        'dashboard/page.tsx': 'export default function Dash() {}',
      });

      const before = getManifest();
      expect(before).not.toContain('access');

      createFile(join(root, 'dashboard/access.ts'), 'export default function access() {}');
      emit('add', join(root, 'dashboard/access.ts'));

      const after = getManifest();
      expect(after).toContain('access');
      expect(after).toContain(join(root, 'dashboard/access.ts'));
      expect(server.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });
    });

    it('adding route.ts regenerates manifest', () => {
      const { emit, root, getManifest, server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      createFile(join(root, 'api/users/route.ts'), 'export function GET() {}');
      emit('add', join(root, 'api/users/route.ts'));

      const after = getManifest();
      expect(after).toContain(join(root, 'api/users/route.ts'));
      expect(server.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });
    });
  });

  describe('deleting route files regenerates manifest', () => {
    it('deleting a page.tsx removes route from manifest', () => {
      const { emit, root, getManifest, server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
        'dashboard/page.tsx': 'export default function Dash() {}',
      });

      // Verify dashboard exists initially
      const before = getManifest();
      expect(before).toContain(join(root, 'dashboard/page.tsx'));

      // Delete the file on disk and trigger event
      unlinkSync(join(root, 'dashboard/page.tsx'));
      emit('unlink', join(root, 'dashboard/page.tsx'));

      // Manifest should no longer reference the deleted file
      const after = getManifest();
      expect(after).not.toContain(join(root, 'dashboard/page.tsx'));
      expect(server.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });
    });

    it('deleting middleware.ts removes it from manifest', () => {
      const { emit, root, getManifest } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
        'dashboard/page.tsx': 'export default function Dash() {}',
        'dashboard/middleware.ts': 'export default function middleware() {}',
      });

      const before = getManifest();
      expect(before).toContain('middleware');

      unlinkSync(join(root, 'dashboard/middleware.ts'));
      emit('unlink', join(root, 'dashboard/middleware.ts'));

      const after = getManifest();
      expect(after).not.toContain(join(root, 'dashboard/middleware.ts'));
    });
  });

  describe('renames (add+unlink) handled correctly', () => {
    it('handles rename as sequential unlink+add', () => {
      const { emit, root, getManifest } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
        'dashboard/page.tsx': 'export default function Dash() {}',
      });

      // Simulate rename: dashboard/ → settings/
      // First, create the new file
      createFile(join(root, 'settings/page.tsx'), 'export default function Settings() {}');

      // Simulate unlink of old + add of new (how chokidar reports renames)
      unlinkSync(join(root, 'dashboard/page.tsx'));
      emit('unlink', join(root, 'dashboard/page.tsx'));
      emit('add', join(root, 'settings/page.tsx'));

      const after = getManifest();
      expect(after).not.toContain(join(root, 'dashboard/page.tsx'));
      expect(after).toContain(join(root, 'settings/page.tsx'));
      expect(after).toContain('settings');
    });
  });

  describe('non-route files do not trigger rescan', () => {
    it('ignores non-route files in app/', () => {
      const { emit, root, server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      // Reset the mock to check for new calls
      server.hot.send.mockClear();

      // These files should NOT trigger a rescan
      const nonRouteFiles = [
        'utils.ts',
        'helpers.tsx',
        'styles.css',
        'README.md',
        'data.json',
        'dashboard/components/button.tsx',
        'dashboard/hooks/useAuth.ts',
        'dashboard/lib/api.ts',
      ];

      for (const file of nonRouteFiles) {
        createFile(join(root, file), '// non-route file');
        emit('add', join(root, file));
      }

      // No HMR full-reload should have been triggered
      expect(server.hot.send).not.toHaveBeenCalled();
    });

    it('ignores files outside app/', () => {
      const { emit, server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      server.hot.send.mockClear();

      // File outside app directory
      emit('add', join(TMP_DIR, 'src/page.tsx'));
      emit('add', join(TMP_DIR, 'page.tsx'));

      expect(server.hot.send).not.toHaveBeenCalled();
    });
  });

  describe('module invalidation', () => {
    it('invalidates manifest module across all environments', () => {
      const { emit, root, moduleGraph } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      // Reset mocks from initial scan
      moduleGraph.invalidateModule.mockClear();

      createFile(join(root, 'dashboard/page.tsx'), 'export default function Dash() {}');
      emit('add', join(root, 'dashboard/page.tsx'));

      // getModuleById should be called for each environment (rsc, ssr, client)
      expect(moduleGraph.getModuleById).toHaveBeenCalledWith(RESOLVED_ID);
      // invalidateModule should be called for each environment that has the module
      expect(moduleGraph.invalidateModule).toHaveBeenCalled();
    });

    it('sends full-reload on route changes', () => {
      const { emit, root, server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      server.hot.send.mockClear();

      createFile(join(root, 'about/page.tsx'), 'export default function About() {}');
      emit('add', join(root, 'about/page.tsx'));

      expect(server.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });
    });
  });

  describe('watcher setup', () => {
    it('watches the app directory', () => {
      const { server, root } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      expect(server.watcher.add).toHaveBeenCalledWith(root);
    });

    it('registers add and unlink listeners', () => {
      const { server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      const events = server.watcher.on.mock.calls.map((call: [string, ...unknown[]]) => call[0]);
      expect(events).toContain('add');
      expect(events).toContain('unlink');
    });
  });

  describe('all route file conventions trigger rescan', () => {
    it.each([
      ['page.tsx', /page/],
      ['layout.tsx', /layout/],
      ['middleware.ts', /middleware/],
      ['access.ts', /access/],
      ['route.ts', /route/],
      ['error.tsx', /error/],
      ['default.tsx', /default/],
      ['denied.tsx', /denied/],
      ['404.tsx', /404/],
      ['5xx.tsx', /5xx/],
      ['not-found.tsx', /not-found/],
      ['forbidden.tsx', /forbidden/],
      ['unauthorized.tsx', /unauthorized/],
    ])('adding %s triggers rescan', (filename, _pattern) => {
      const { emit, root, server } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      server.hot.send.mockClear();

      createFile(join(root, 'dashboard', filename), 'export default function() {}');
      emit('add', join(root, 'dashboard', filename));

      expect(server.hot.send).toHaveBeenCalledWith({ type: 'full-reload' });
    });
  });

  describe('route tree state after watch events', () => {
    it('ctx.routeTree is updated after add', () => {
      const { ctx, emit, root } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
      });

      // No dashboard initially
      expect(
        ctx.routeTree!.root.children.find((c) => c.segmentName === 'dashboard')
      ).toBeUndefined();

      createFile(join(root, 'dashboard/page.tsx'), 'export default function Dash() {}');
      emit('add', join(root, 'dashboard/page.tsx'));

      const dashboard = ctx.routeTree!.root.children.find((c) => c.segmentName === 'dashboard');
      expect(dashboard).toBeDefined();
      expect(dashboard!.page).toBeDefined();
    });

    it('ctx.routeTree is updated after unlink', () => {
      const { ctx, emit, root } = setupPlugin({
        'page.tsx': 'export default function Home() {}',
        'dashboard/page.tsx': 'export default function Dash() {}',
      });

      // Dashboard exists initially
      expect(ctx.routeTree!.root.children.find((c) => c.segmentName === 'dashboard')).toBeDefined();

      unlinkSync(join(root, 'dashboard/page.tsx'));
      emit('unlink', join(root, 'dashboard/page.tsx'));

      // Dashboard segment still exists (directory still there) but has no page
      const dashboard = ctx.routeTree!.root.children.find((c) => c.segmentName === 'dashboard');
      expect(dashboard).toBeDefined();
      expect(dashboard!.page).toBeUndefined();
    });
  });
});
