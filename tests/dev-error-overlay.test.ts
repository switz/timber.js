/**
 * Tests for the dev error overlay system.
 *
 * Verifies:
 * - Stack frame classification (app/framework/internal)
 * - Terminal error formatting with ANSI frame dimming
 * - Vite overlay payload construction
 * - Error phase classification from stack traces
 * - Component stack extraction from React render errors
 * - Integration with dev-server middleware
 *
 * Design ref: 21-dev-server.md §"Error Overlay"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ViteDevServer } from 'vite';
import {
  classifyFrame,
  extractComponentStack,
  parseFirstAppFrame,
  classifyErrorPhase,
  formatTerminalError,
  sendErrorToOverlay,
} from '../packages/timber-app/src/plugins/dev-error-overlay';
import { timberDevServer } from '../packages/timber-app/src/plugins/dev-server';
import type { PluginContext } from '../packages/timber-app/src/index';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Mock isRunnableDevEnvironment to always return true in tests
vi.mock('vite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vite')>();
  return {
    ...actual,
    isRunnableDevEnvironment: () => true,
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = '/project';

function createError(message: string, stack: string): Error {
  const err = new Error(message);
  err.stack = stack;
  return err;
}

function createRenderError(message: string, stack: string, componentStack: string): Error {
  const err = createError(message, stack);
  (err as Error & { componentStack: string }).componentStack = componentStack;
  return err;
}

function createPluginContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    config: { output: 'server', ...overrides.config },
    routeTree: null,
    appDir: '/project/app',
    root: PROJECT_ROOT,
    dev: false,
    buildManifest: null,
    ...overrides,
  };
}

function createMockServer() {
  const handlers: Array<
    (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>
  > = [];
  const rscRunner = {
    import: vi.fn(async () => ({
      default: async () => new Response('OK', { status: 200 }),
    })),
  };
  return {
    server: {
      middlewares: {
        use: vi.fn(
          (
            handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>
          ) => {
            handlers.push(handler);
          }
        ),
      },
      ssrLoadModule: vi.fn(async () => ({
        default: async () => new Response('OK', { status: 200 }),
      })),
      ssrFixStacktrace: vi.fn(),
      watcher: { on: vi.fn().mockReturnThis(), add: vi.fn() },
      restart: vi.fn(),
      environments: {
        rsc: { runner: rscRunner },
      },
      config: { root: PROJECT_ROOT },
      hot: { send: vi.fn() },
    } as unknown as ViteDevServer,
    handlers,
    rscRunner,
    get raw() {
      return this.server as unknown as {
        ssrLoadModule: ReturnType<typeof vi.fn>;
        ssrFixStacktrace: ReturnType<typeof vi.fn>;
        hot: { send: ReturnType<typeof vi.fn> };
        environments: { rsc: { runner: { import: ReturnType<typeof vi.fn> } } };
      };
    },
  };
}

/**
 * Create a mock RSC module that captures the registered pipeline error handler.
 * Returns the captured handler so tests can invoke it directly.
 */
function createPipelineErrorCapture(rscHandler: (req: Request) => Promise<Response>) {
  let capturedHandler: ((error: Error, phase: string) => void) | undefined;
  const rscModule = {
    default: rscHandler,
    setDevPipelineErrorHandler: (fn: (error: Error, phase: string) => void) => {
      capturedHandler = fn;
    },
  };
  const fire = (error: Error, phase: string) => {
    if (capturedHandler) capturedHandler(error, phase);
  };
  return { rscModule, fire };
}

// ─── Frame Classification ───────────────────────────────────────────────

describe('frame classification', () => {
  it('classifies app frames as "app"', () => {
    expect(classifyFrame('    at handler (/project/app/page.tsx:10:5)', PROJECT_ROOT)).toBe('app');
  });

  it('classifies timber-app frames as "framework"', () => {
    expect(
      classifyFrame('    at render (packages/timber-app/src/server/render.ts:45:3)', PROJECT_ROOT)
    ).toBe('framework');
  });

  it('classifies node_modules frames as "internal"', () => {
    expect(
      classifyFrame('    at Module._compile (node_modules/ts-node/src/index.ts:5:3)', PROJECT_ROOT)
    ).toBe('internal');
  });

  it('classifies node: frames as "internal"', () => {
    expect(
      classifyFrame(
        '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
        PROJECT_ROOT
      )
    ).toBe('internal');
  });
});

// ─── Component Stack Extraction ─────────────────────────────────────────

describe('component stack extraction', () => {
  it('extracts componentStack from render errors', () => {
    const err = createRenderError(
      'Cannot read property',
      'Error: Cannot read property\n    at fn (/project/app/page.tsx:10:5)',
      '  at ProductCard (app/products/product-card.tsx:23)\n  at ProductGrid (app/products/product-grid.tsx:15)'
    );
    expect(extractComponentStack(err)).toContain('ProductCard');
  });

  it('returns null for non-render errors', () => {
    const err = new Error('normal error');
    expect(extractComponentStack(err)).toBeNull();
  });

  it('returns null for non-Error values', () => {
    expect(extractComponentStack('string error')).toBeNull();
    expect(extractComponentStack(null)).toBeNull();
    expect(extractComponentStack(42)).toBeNull();
  });
});

// ─── First App Frame Parsing ────────────────────────────────────────────

describe('first app frame parsing', () => {
  it('extracts file/line/column from first app frame', () => {
    const stack =
      'Error: boom\n' +
      '    at renderComponent (packages/timber-app/src/server/render.ts:45:3)\n' +
      '    at ProductCard (/project/app/products/card.tsx:23:18)\n' +
      '    at ProductPage (/project/app/products/page.tsx:8:5)';

    const loc = parseFirstAppFrame(stack, PROJECT_ROOT);
    expect(loc).toEqual({
      file: '/project/app/products/card.tsx',
      line: 23,
      column: 18,
    });
  });

  it('returns null when no app frames exist', () => {
    const stack =
      'Error: boom\n' +
      '    at internal (node:internal/process:10:5)\n' +
      '    at Module (node_modules/vite/dist/node/index.js:100:3)';

    expect(parseFirstAppFrame(stack, PROJECT_ROOT)).toBeNull();
  });
});

// ─── Error Phase Classification ─────────────────────────────────────────

describe('error phase classification', () => {
  it('detects middleware errors from stack', () => {
    const err = createError(
      'fail',
      'Error: fail\n    at handler (/project/app/dashboard/middleware.ts:10:5)'
    );
    expect(classifyErrorPhase(err, PROJECT_ROOT)).toBe('middleware');
  });

  it('detects access errors from stack', () => {
    const err = createError('fail', 'Error: fail\n    at check (/project/app/admin/access.ts:8:3)');
    expect(classifyErrorPhase(err, PROJECT_ROOT)).toBe('access');
  });

  it('detects render errors from componentStack', () => {
    const err = createRenderError(
      'fail',
      'Error: fail\n    at fn (/project/app/page.tsx:5:3)',
      '  at Page (app/page.tsx:5)'
    );
    expect(classifyErrorPhase(err, PROJECT_ROOT)).toBe('render');
  });

  it('detects route handler errors from stack', () => {
    const err = createError(
      'fail',
      'Error: fail\n    at GET (/project/app/api/users/route.ts:12:5)'
    );
    expect(classifyErrorPhase(err, PROJECT_ROOT)).toBe('handler');
  });

  it('defaults to render for unclassifiable errors', () => {
    const err = createError('fail', 'Error: fail\n    at unknown (/somewhere/else.js:1:1)');
    expect(classifyErrorPhase(err, PROJECT_ROOT)).toBe('render');
  });
});

// ─── Terminal Formatting ────────────────────────────────────────────────

describe('terminal error formatting', () => {
  it('dims framework-internal frames', () => {
    const err = createError(
      'render failed',
      'Error: render failed\n' +
        '    at Component (/project/app/page.tsx:10:5)\n' +
        '    at renderComponent (packages/timber-app/src/server/render.ts:45:3)'
    );

    const output = formatTerminalError(err, 'render', PROJECT_ROOT);
    // Framework frame should be dimmed (\x1b[2m)
    expect(output).toContain('\x1b[2m');
    // App frame should NOT be dimmed
    expect(output).toContain('    at Component (/project/app/page.tsx:10:5)');
  });

  it('shows application frames at normal brightness', () => {
    const err = createError('boom', 'Error: boom\n    at handler (/project/app/page.tsx:10:5)');
    const output = formatTerminalError(err, 'middleware', PROJECT_ROOT);
    // The app frame line should appear without DIM prefix
    const lines = output.split('\n');
    const appLine = lines.find((l: string) => l.includes('/project/app/page.tsx'));
    expect(appLine).toBeDefined();
    expect(appLine!.startsWith('\x1b[2m')).toBe(false);
  });

  it('colors error message red', () => {
    const err = createError('something broke', 'Error: something broke\n    at fn (/x:1:1)');
    const output = formatTerminalError(err, 'render', PROJECT_ROOT);
    expect(output).toContain('\x1b[31msomething broke\x1b[0m');
  });

  it('includes component stack for render errors', () => {
    const err = createRenderError(
      'fail',
      'Error: fail\n    at fn (/project/app/page.tsx:5:3)',
      '  at ProductCard (app/products/card.tsx:23)\n  at ProductPage (app/products/page.tsx:8)'
    );
    const output = formatTerminalError(err, 'render', PROJECT_ROOT);
    expect(output).toContain('Component Stack:');
    expect(output).toContain('ProductCard');
    expect(output).toContain('ProductPage');
  });

  it('labels the pipeline phase', () => {
    const err = createError('boom', 'Error: boom\n    at fn (/x:1:1)');

    expect(formatTerminalError(err, 'middleware', PROJECT_ROOT)).toContain('Middleware Error');
    expect(formatTerminalError(err, 'access', PROJECT_ROOT)).toContain('Access Check Error');
    expect(formatTerminalError(err, 'render', PROJECT_ROOT)).toContain('RSC Render Error');
    expect(formatTerminalError(err, 'handler', PROJECT_ROOT)).toContain('Route Handler Error');
    expect(formatTerminalError(err, 'module-transform', PROJECT_ROOT)).toContain(
      'Module Transform Error'
    );
  });
});

// ─── Overlay Payload Construction ───────────────────────────────────────

describe('overlay payload construction', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('calls ssrFixStacktrace before building payload', () => {
    const { server, raw } = createMockServer();
    const err = createError('boom', 'Error: boom\n    at fn (/project/app/page.tsx:5:3)');

    sendErrorToOverlay(server, err, 'render', PROJECT_ROOT);

    expect(raw.ssrFixStacktrace).toHaveBeenCalledWith(err);
    // ssrFixStacktrace called before hot.send
    expect(raw.ssrFixStacktrace.mock.invocationCallOrder[0]).toBeLessThan(
      raw.hot.send.mock.invocationCallOrder[0]!
    );
  });

  it('sends error payload to browser via hot.send', () => {
    const { server, raw } = createMockServer();
    const err = createError('boom', 'Error: boom\n    at fn (/project/app/page.tsx:5:3)');

    sendErrorToOverlay(server, err, 'render', PROJECT_ROOT);

    expect(raw.hot.send).toHaveBeenCalledWith({
      type: 'error',
      err: expect.objectContaining({
        message: 'boom',
        stack: expect.stringContaining('boom'),
        plugin: 'timber (RSC Render)',
      }),
    });
  });

  it('includes loc from first app frame', () => {
    const { server, raw } = createMockServer();
    const err = createError(
      'boom',
      'Error: boom\n' +
        '    at internal (packages/timber-app/src/render.ts:10:3)\n' +
        '    at Component (/project/app/page.tsx:42:18)'
    );

    sendErrorToOverlay(server, err, 'render', PROJECT_ROOT);

    const payload = raw.hot.send.mock.calls[0]![0] as { err: { loc?: { line: number } } };
    expect(payload.err.loc).toEqual({
      file: '/project/app/page.tsx',
      line: 42,
      column: 18,
    });
  });

  it('prepends component stack for render errors', () => {
    const { server, raw } = createMockServer();
    const err = createRenderError(
      'fail',
      'Error: fail\n    at fn (/project/app/page.tsx:5:3)',
      '  at ProductCard (app/card.tsx:23)'
    );

    sendErrorToOverlay(server, err, 'render', PROJECT_ROOT);

    const payload = raw.hot.send.mock.calls[0]![0] as { err: { message: string } };
    expect(payload.err.message).toContain('Component Stack:');
    expect(payload.err.message).toContain('ProductCard');
  });

  it('writes formatted error to stderr', () => {
    const { server } = createMockServer();
    const err = createError('boom', 'Error: boom\n    at fn (/project/app/page.tsx:5:3)');

    sendErrorToOverlay(server, err, 'render', PROJECT_ROOT);

    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output).toContain('boom');
    expect(output).toContain('RSC Render Error');
  });
});

// ─── Dev Server Integration ─────────────────────────────────────────────

describe('dev server integration', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  function setupMiddleware(
    overrides: {
      rscHandler?: (req: Request) => Promise<Response>;
      rscRunnerImportError?: Error;
    } = {}
  ) {
    const ctx = createPluginContext();
    const plugin = timberDevServer(ctx);
    const mock = createMockServer();

    if (overrides.rscRunnerImportError) {
      (mock.rscRunner as { import: unknown }).import = vi.fn(async () => {
        throw overrides.rscRunnerImportError;
      });
    } else if (overrides.rscHandler) {
      (mock.rscRunner as { import: unknown }).import = vi.fn(async () => ({
        default: overrides.rscHandler,
      }));
    }

    const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
    const postHook = configureServer.call({}, mock.server);
    if (typeof postHook === 'function') postHook();

    return { handler: mock.handlers[0]!, mock };
  }

  async function invokeHandler(
    handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>,
    url: string
  ) {
    const req = {
      url,
      method: 'GET',
      headers: { host: 'localhost:5173' },
      on: vi.fn(),
    } as unknown as IncomingMessage;
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse;
    const next = vi.fn();

    await handler(req, res, next);
    return {
      req,
      res: res as unknown as { statusCode: number; end: ReturnType<typeof vi.fn> },
      next,
    };
  }

  it('sends module transform errors to overlay on RSC runner import failure', async () => {
    const syntaxError = new SyntaxError('Unexpected token');
    syntaxError.stack = 'SyntaxError: Unexpected token\n    at parse (/project/app/page.tsx:5:10)';
    const { handler, mock } = setupMiddleware({ rscRunnerImportError: syntaxError });

    const { res } = await invokeHandler(handler, '/dashboard');

    expect(res.statusCode).toBe(500);
    expect(mock.raw.ssrFixStacktrace).toHaveBeenCalledWith(syntaxError);
    expect(mock.raw.hot.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('sends pipeline errors to overlay with phase classification', async () => {
    const middlewareError = new Error('Middleware failed');
    middlewareError.stack =
      'Error: Middleware failed\n    at handler (/project/app/dashboard/middleware.ts:10:5)';

    const { handler, mock } = setupMiddleware({
      rscHandler: async () => {
        throw middlewareError;
      },
    });

    const { res } = await invokeHandler(handler, '/dashboard');

    expect(res.statusCode).toBe(500);
    expect(mock.raw.hot.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        err: expect.objectContaining({
          plugin: 'timber (Middleware)',
        }),
      })
    );
  });

  it('server remains running after error — next request succeeds', async () => {
    const { handler, mock } = setupMiddleware();

    // First request: RSC runner.import throws
    mock.rscRunner.import = vi
      .fn()
      .mockRejectedValueOnce(new Error('syntax error'))
      .mockResolvedValueOnce({
        default: async () => new Response('OK', { status: 200 }),
      });

    const first = await invokeHandler(handler, '/dashboard');
    expect(first.res.statusCode).toBe(500);

    // Second request: succeeds (file was fixed, module reloaded)
    const second = await invokeHandler(handler, '/dashboard');
    expect(second.res.statusCode).toBe(200);
  });

  it('pipeline render error shows in overlay', async () => {
    const renderError = new Error('render boom');
    renderError.stack = 'Error: render boom\n    at Component (/project/app/page.tsx:10:5)';

    const { rscModule, fire } = createPipelineErrorCapture(
      async () => new Response('ok', { status: 200 })
    );
    const ctx = createPluginContext();
    const plugin = timberDevServer(ctx);
    const mock = createMockServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mock.rscRunner.import = vi.fn(async () => rscModule) as any;

    const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
    configureServer.call({}, mock.server);

    // Trigger the first request so the dev server registers the handler
    await invokeHandler(mock.handlers[0]!, '/page');

    // Now simulate a pipeline render error coming through onPipelineError
    fire(renderError, 'render');

    expect(mock.raw.hot.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        err: expect.objectContaining({ message: 'render boom' }),
      })
    );
  });

  it('pipeline middleware error shows in overlay', async () => {
    const middlewareError = new Error('middleware boom');
    middlewareError.stack =
      'Error: middleware boom\n    at handler (/project/app/dashboard/middleware.ts:10:5)';

    const { rscModule, fire } = createPipelineErrorCapture(
      async () => new Response('ok', { status: 200 })
    );
    const ctx = createPluginContext();
    const plugin = timberDevServer(ctx);
    const mock = createMockServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mock.rscRunner.import = vi.fn(async () => rscModule) as any;

    const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
    configureServer.call({}, mock.server);

    await invokeHandler(mock.handlers[0]!, '/dashboard');

    fire(middlewareError, 'middleware');

    expect(mock.raw.hot.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        err: expect.objectContaining({
          plugin: 'timber (Middleware)',
        }),
      })
    );
  });

  it('ssrFixStacktrace called for pipeline errors', async () => {
    const renderError = new Error('render boom');
    renderError.stack = 'Error: render boom\n    at Component (/project/app/page.tsx:10:5)';

    const { rscModule, fire } = createPipelineErrorCapture(
      async () => new Response('ok', { status: 200 })
    );
    const ctx = createPluginContext();
    const plugin = timberDevServer(ctx);
    const mock = createMockServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mock.rscRunner.import = vi.fn(async () => rscModule) as any;

    const configureServer = plugin.configureServer as (s: ViteDevServer) => (() => void) | void;
    configureServer.call({}, mock.server);

    await invokeHandler(mock.handlers[0]!, '/page');

    fire(renderError, 'render');

    expect(mock.raw.ssrFixStacktrace).toHaveBeenCalledWith(renderError);
  });

  it('error logged to both browser overlay and stderr', async () => {
    const pipelineError = new Error('render boom');
    pipelineError.stack = 'Error: render boom\n    at Component (/project/app/page.tsx:10:5)';

    const { handler, mock } = setupMiddleware({
      rscHandler: async () => {
        throw pipelineError;
      },
    });

    await invokeHandler(handler, '/page');

    // Browser overlay
    expect(mock.raw.hot.send).toHaveBeenCalled();
    // stderr
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls.map((c: [unknown]) => c[0] as string).join('');
    expect(output).toContain('render boom');
  });
});
