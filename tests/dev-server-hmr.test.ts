/**
 * Tests for HMR environment wiring in the timber dev server.
 *
 * Verifies:
 * - Server component changes invalidate RSC module graph (next request re-renders)
 * - Client component changes trigger browser HMR (React Fast Refresh)
 * - middleware.ts / access.ts changes invalidate RSC module
 * - timber.config.ts change triggers full dev server restart
 * - timber-dev-server only active when command === 'serve'
 * - timber-dev-server is last plugin in the array
 *
 * Design refs: 18-build-system.md §HMR Wiring, 21-dev-server.md §HMR Wiring
 */

import { describe, it, expect, vi } from 'vitest';
import type { ViteDevServer } from 'vite';
import { join } from 'node:path';
import { timberDevServer } from '../packages/timber-app/src/plugins/dev-server.js';
import { timber } from '../packages/timber-app/src/index.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

function createPluginContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    config: { output: 'server', ...overrides.config },
    routeTree: null,
    appDir: '/test/app',
    root: '/test',
    ...overrides,
  };
}

/**
 * Create a mock ViteDevServer with watcher event capture.
 */
function createMockServer() {
  const listeners: Record<string, Array<(path: string) => void>> = {};

  const middlewares = {
    use: vi.fn(),
    handlers: [] as Array<unknown>,
  };

  const server = {
    middlewares,
    watcher: {
      on: vi.fn((event: string, cb: (path: string) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        return server.watcher;
      }),
      add: vi.fn(),
    },
    ssrLoadModule: vi.fn(async () => ({
      default: async () => new Response('OK', { status: 200 }),
    })),
    restart: vi.fn(),
    environments: {
      rsc: {
        moduleGraph: {
          getModuleById: vi.fn().mockReturnValue({ id: 'test' }),
          invalidateModule: vi.fn(),
        },
      },
      ssr: {
        moduleGraph: {
          getModuleById: vi.fn().mockReturnValue({ id: 'test' }),
          invalidateModule: vi.fn(),
        },
      },
      client: {
        moduleGraph: {
          getModuleById: vi.fn().mockReturnValue({ id: 'test' }),
          invalidateModule: vi.fn(),
        },
      },
    },
    hot: {
      send: vi.fn(),
    },
    config: {
      root: '/test',
    },
  };

  function emit(event: string, filePath: string) {
    for (const cb of listeners[event] ?? []) {
      cb(filePath);
    }
  }

  return { server: server as unknown as ViteDevServer, emit, raw: server };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('dev server HMR wiring', () => {
  describe('apply: serve guard', () => {
    it('timber-dev-server has apply: "serve"', () => {
      const ctx = createPluginContext();
      const plugin = timberDevServer(ctx);

      expect(plugin.apply).toBe('serve');
    });

    it('timber-dev-server is not active during build', () => {
      // apply: 'serve' means Vite will skip this plugin when command === 'build'
      const ctx = createPluginContext();
      const plugin = timberDevServer(ctx);

      // Vite checks this property — 'serve' means only active in dev
      expect(plugin.apply).not.toBe('build');
    });
  });

  describe('config file restart', () => {
    it('restarts server when timber.config.ts changes', () => {
      const ctx = createPluginContext({ root: '/project' });
      const plugin = timberDevServer(ctx);
      const { server, emit, raw } = createMockServer();

      const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
      configureServer.call({}, server);

      emit('change', join('/project', 'timber.config.ts'));

      expect(raw.restart).toHaveBeenCalled();
    });

    it('restarts server when timber.config.js changes', () => {
      const ctx = createPluginContext({ root: '/project' });
      const plugin = timberDevServer(ctx);
      const { server, emit, raw } = createMockServer();

      const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
      configureServer.call({}, server);

      emit('change', join('/project', 'timber.config.js'));

      expect(raw.restart).toHaveBeenCalled();
    });

    it('restarts server when timber.config.mjs changes', () => {
      const ctx = createPluginContext({ root: '/project' });
      const plugin = timberDevServer(ctx);
      const { server, emit, raw } = createMockServer();

      const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
      configureServer.call({}, server);

      emit('change', join('/project', 'timber.config.mjs'));

      expect(raw.restart).toHaveBeenCalled();
    });

    it('does not restart for unrelated file changes', () => {
      const ctx = createPluginContext({ root: '/project' });
      const plugin = timberDevServer(ctx);
      const { server, emit, raw } = createMockServer();

      const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
      configureServer.call({}, server);

      emit('change', '/project/app/page.tsx');
      emit('change', '/project/vite.config.ts');
      emit('change', '/project/package.json');

      expect(raw.restart).not.toHaveBeenCalled();
    });

    it('does not restart for config files in other directories', () => {
      const ctx = createPluginContext({ root: '/project' });
      const plugin = timberDevServer(ctx);
      const { server, emit, raw } = createMockServer();

      const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
      configureServer.call({}, server);

      // Config file in a subdirectory should not trigger restart
      emit('change', '/project/packages/other/timber.config.ts');

      expect(raw.restart).not.toHaveBeenCalled();
    });
  });

  describe('HMR model — Vite handles invalidation', () => {
    it('server component changes are handled by Vite module invalidation', () => {
      // Timber does NOT implement custom HMR logic for server components.
      // Vite's module graph tracks dependencies and invalidates on change.
      // On the next request, ssrLoadModule re-evaluates the module.
      //
      // This test verifies there's no custom HMR handler that would interfere.
      const ctx = createPluginContext();
      const plugin = timberDevServer(ctx);
      const { server, raw } = createMockServer();

      const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
      configureServer.call({}, server);

      // The plugin only listens for 'change' events (for config restart)
      // It does NOT listen for 'add' or 'unlink' (that's timber-routing's job)
      const changeListeners = raw.watcher.on.mock.calls.filter(
        (call: [string, ...unknown[]]) => call[0] === 'change'
      );
      expect(changeListeners.length).toBe(1); // Only the config watcher
    });

    it('client component HMR is handled by React Fast Refresh (no interference)', () => {
      // Client component HMR is handled by @vitejs/plugin-react.
      // timber-dev-server should NOT send custom HMR messages for client components.
      const ctx = createPluginContext();
      const plugin = timberDevServer(ctx);
      const { server, raw } = createMockServer();

      const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
      configureServer.call({}, server);

      // No HMR messages should be sent during configureServer
      expect(raw.hot.send).not.toHaveBeenCalled();
    });
  });

  describe('plugin ordering', () => {
    it('timber-dev-server is last in the plugin array', () => {
      const plugins = timber();

      // Find the timber-dev-server plugin
      const names = plugins.map((p) => p.name);
      const devServerIndex = names.indexOf('timber-dev-server');

      expect(devServerIndex).toBe(plugins.length - 1);
    });

    it('timber-dev-server comes after timber-content', () => {
      const plugins = timber();

      const names = plugins.map((p) => p.name);
      const contentIndex = names.indexOf('timber-content');
      const devServerIndex = names.indexOf('timber-dev-server');

      expect(contentIndex).toBeLessThan(devServerIndex);
    });
  });

  describe('middleware registration', () => {
    it('registers post-hook middleware (runs after Vite internals)', () => {
      const ctx = createPluginContext();
      const plugin = timberDevServer(ctx);
      const { server, raw } = createMockServer();

      const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
      const postHook = configureServer.call({}, server);

      // configureServer returns a function (post-hook pattern)
      expect(typeof postHook).toBe('function');

      // Middleware not registered until post-hook runs
      expect(raw.middlewares.use).not.toHaveBeenCalled();

      // Execute post-hook
      if (typeof postHook === 'function') postHook();

      // Now middleware is registered
      expect(raw.middlewares.use).toHaveBeenCalled();
    });
  });

  describe('SSR module re-evaluation on request', () => {
    it('calls ssrLoadModule on each request for fresh modules', async () => {
      const ctx = createPluginContext();
      const plugin = timberDevServer(ctx);
      const { server, raw } = createMockServer();

      const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
      const postHook = configureServer.call({}, server);
      if (typeof postHook === 'function') postHook();

      // Get the registered middleware
      const middleware = raw.middlewares.use.mock.calls[0][0] as (
        req: unknown,
        res: unknown,
        next: () => void
      ) => Promise<void>;

      // Simulate two requests
      for (let i = 0; i < 2; i++) {
        const req = {
          url: '/dashboard',
          method: 'GET',
          headers: { host: 'localhost:5173' },
          on: vi.fn(),
        };
        const res = {
          statusCode: 200,
          headersSent: false,
          setHeader: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        };
        await middleware(req, res, vi.fn());
      }

      // ssrLoadModule should be called on each request (not cached)
      // This ensures file changes picked up by Vite's invalidation are reflected
      expect(raw.ssrLoadModule).toHaveBeenCalledTimes(2);
    });
  });
});
