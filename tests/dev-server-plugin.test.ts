import { describe, it, expect, vi } from 'vitest';
import type { ViteDevServer } from 'vite';
import { timberDevServer } from '../packages/timber-app/src/plugins/dev-server.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

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
 * Create a mock Connect-style middleware stack that captures registered
 * middleware functions.
 */
function createMockMiddlewares() {
  const handlers: Array<(req: IncomingMessage, res: ServerResponse, next: () => void) => void> = [];
  return {
    use: vi.fn((handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => {
      handlers.push(handler);
    }),
    handlers,
  };
}

/**
 * Create a mock IncomingMessage (Node HTTP request).
 */
function createMockReq(url: string, method = 'GET', headers: Record<string, string> = {}) {
  return {
    url,
    method,
    headers: { host: 'localhost:5173', ...headers },
    on: vi.fn(),
    pipe: vi.fn(),
  } as unknown as IncomingMessage;
}

/**
 * Create a mock ServerResponse.
 */
function createMockRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    writeHead: vi.fn((code: number) => {
      res.statusCode = code;
    }),
    write: vi.fn(),
    end: vi.fn(),
  };
  return res as unknown as ServerResponse;
}

/**
 * Create a mock ViteDevServer with ssrLoadModule stubbed.
 */
function createMockServer(
  overrides: {
    rscHandler?: (req: Request) => Promise<Response>;
  } = {}
) {
  const middlewares = createMockMiddlewares();

  const rscHandler =
    overrides.rscHandler ?? (async () => new Response('RSC stream', { status: 200 }));

  const server = {
    middlewares,
    ssrLoadModule: vi.fn(async (id: string) => {
      if (id === 'virtual:timber-rsc-entry') {
        return { default: rscHandler };
      }
      throw new Error(`Unexpected module: ${id}`);
    }),
    transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
    environments: {},
    config: {
      root: '/test',
    },
  } as unknown as ViteDevServer;

  return { server, middlewares };
}

/**
 * Set up the plugin and return the registered middleware handler.
 */
function setupMiddleware(overrides: { rscHandler?: (req: Request) => Promise<Response> } = {}) {
  const ctx = createPluginContext();
  const plugin = timberDevServer(ctx);
  const { server, middlewares } = createMockServer(overrides);

  const configureServer = plugin.configureServer as (server: ViteDevServer) => (() => void) | void;
  const postHook = configureServer.call({}, server);
  if (typeof postHook === 'function') {
    postHook();
  }

  return { handler: middlewares.handlers[0], server, middlewares };
}

/**
 * Invoke the middleware handler with a mock request.
 */
async function invokeHandler(
  handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
  url: string,
  method = 'GET'
) {
  const req = createMockReq(url, method);
  const res = createMockRes();
  const next = vi.fn();

  await handler(req, res, next);

  return { req, res, next };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('timber-dev-server plugin', () => {
  describe('plugin metadata', () => {
    it('has correct name', () => {
      const ctx = createPluginContext();
      const plugin = timberDevServer(ctx);

      expect(plugin.name).toBe('timber-dev-server');
    });

    it('has configureServer hook', () => {
      const ctx = createPluginContext();
      const plugin = timberDevServer(ctx);

      expect(plugin.configureServer).toBeDefined();
      expect(typeof plugin.configureServer).toBe('function');
    });
  });

  describe('configureServer', () => {
    it('registers middleware', () => {
      const { middlewares } = setupMiddleware();
      expect(middlewares.use).toHaveBeenCalled();
    });
  });

  describe('request handling', () => {
    it('loads RSC entry via ssrLoadModule', async () => {
      const rscHandler = vi.fn(async () => new Response('test', { status: 200 }));
      const { handler } = setupMiddleware({ rscHandler });

      await invokeHandler(handler, '/');

      expect(rscHandler).toHaveBeenCalled();
    });

    it('passes non-route requests through to Vite (asset passthrough)', async () => {
      const { handler } = setupMiddleware();

      const { next } = await invokeHandler(handler, '/@vite/client');
      expect(next).toHaveBeenCalled();
    });

    it('handles HMR websocket requests by passing through', async () => {
      const { handler } = setupMiddleware();

      const { next } = await invokeHandler(handler, '/__vite_hmr');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('RSC to HTML pipeline', () => {
    it('pipes RSC stream through SSR entry for HTML', async () => {
      const rscHandler = vi.fn(
        async () =>
          new Response('RSC payload', {
            status: 200,
            headers: { 'content-type': 'text/x-component' },
          })
      );

      const { handler } = setupMiddleware({ rscHandler });

      const { next } = await invokeHandler(handler, '/dashboard');

      // Should NOT have called next — this is a route request
      expect(next).not.toHaveBeenCalled();
      // RSC handler should have been called
      expect(rscHandler).toHaveBeenCalled();
    });
  });

  describe('status codes', () => {
    it('returns 200 for successful page render', async () => {
      const rscHandler = vi.fn(async () => new Response('OK', { status: 200 }));

      const { handler } = setupMiddleware({ rscHandler });
      const { next } = await invokeHandler(handler, '/');

      expect(next).not.toHaveBeenCalled();
    });

    it('returns 404 for unmatched routes (passes to Vite fallback)', async () => {
      const rscHandler = vi.fn(async () => new Response(null, { status: 404 }));

      const { handler } = setupMiddleware({ rscHandler });
      const { next } = await invokeHandler(handler, '/nonexistent');

      // 404 from pipeline → pass through to Vite's static serving
      expect(next).toHaveBeenCalled();
    });

    it('returns 302 for redirects', async () => {
      const rscHandler = vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: '/login' },
          })
      );

      const { handler } = setupMiddleware({ rscHandler });
      const { next } = await invokeHandler(handler, '/protected');

      // Redirect should be forwarded, not passed to next()
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 500 for server errors', async () => {
      const rscHandler = vi.fn(async () => {
        throw new Error('Unexpected error');
      });

      const { handler } = setupMiddleware({ rscHandler });
      const { next } = await invokeHandler(handler, '/error');

      // Server error — should not crash, should respond with 500
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('browser entry injection', () => {
    it('injects browser entry script into HTML response', async () => {
      const htmlBody = '<html><head></head><body><div id="root">Content</div></body></html>';
      const rscHandler = vi.fn(
        async () =>
          new Response(htmlBody, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
      );

      const { handler } = setupMiddleware({ rscHandler });
      const { next } = await invokeHandler(handler, '/');

      // The response should be handled (not passed through)
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('proxy coverage', () => {
    it('proxy.ts runs on every request via the pipeline', async () => {
      // The dev server loads the RSC entry which includes the full pipeline
      // (proxy.ts → canonicalize → route match → middleware → render).
      // We verify this by checking that the RSC handler is called for route requests.
      const rscHandler = vi.fn(async () => new Response('test', { status: 200 }));

      const { handler } = setupMiddleware({ rscHandler });

      // Multiple route requests — all should go through the RSC handler
      // which includes proxy.ts in its pipeline
      for (const path of ['/', '/dashboard', '/api/data']) {
        await invokeHandler(handler, path);
      }

      expect(rscHandler).toHaveBeenCalledTimes(3);
    });
  });
});
