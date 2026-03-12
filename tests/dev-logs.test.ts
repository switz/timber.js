import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerLogPayload, ServerLogLevel } from '../packages/timber-app/src/plugins/dev-logs';

// ─── Mock Vite Server ────────────────────────────────────────────────────

interface MockViteServer {
  hot: {
    send: ReturnType<typeof vi.fn>;
  };
  httpServer: {
    on: ReturnType<typeof vi.fn>;
  };
}

function createMockServer(): MockViteServer {
  return {
    hot: {
      send: vi.fn(),
    },
    httpServer: {
      on: vi.fn(),
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

let originalConsole: Record<ServerLogLevel, (...args: unknown[]) => void>;

beforeEach(() => {
  // Save originals before each test
  originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    info: console.info,
  };
});

afterEach(() => {
  // Restore originals after each test
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
});

// ─── Serialization Tests ─────────────────────────────────────────────────

describe('dev-logs serialization', () => {
  // Import the module dynamically to test serializeArg behavior
  // through the patched console methods

  it('forwards console.log to HMR WebSocket', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    // Call configureServer to patch console
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    console.log('hello from server');

    expect(mockServer.hot.send).toHaveBeenCalledWith(
      'timber:server-log',
      expect.objectContaining({
        level: 'log',
        args: ['hello from server'],
      })
    );
  });

  it('preserves all log levels', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    const levels: ServerLogLevel[] = ['log', 'warn', 'error', 'debug', 'info'];
    for (const level of levels) {
      mockServer.hot.send.mockClear();
      console[level](`test ${level}`);

      expect(mockServer.hot.send).toHaveBeenCalledWith(
        'timber:server-log',
        expect.objectContaining({ level })
      );
    }
  });

  it('still calls original console method', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const originalLog = vi.fn();
    console.log = originalLog;

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    console.log('test');

    expect(originalLog).toHaveBeenCalledWith('test');
  });

  it('serializes objects and arrays', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    console.log('data:', { name: 'test', count: 42 }, [1, 2, 3]);

    const payload = mockServer.hot.send.mock.calls[0][1] as ServerLogPayload;
    expect(payload.args[0]).toBe('data:');
    expect(payload.args[1]).toEqual({ name: 'test', count: 42 });
    expect(payload.args[2]).toEqual([1, 2, 3]);
  });

  it('serializes Error objects', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    const err = new TypeError('bad input');
    console.error('Error:', err);

    const payload = mockServer.hot.send.mock.calls[0][1] as ServerLogPayload;
    expect(payload.args[0]).toBe('Error:');
    expect(payload.args[1]).toEqual(
      expect.objectContaining({
        __type: 'Error',
        name: 'TypeError',
        message: 'bad input',
      })
    );
  });

  it('redacts sensitive keys', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    console.log({ API_KEY: 'sk-secret-123', name: 'safe' });

    const payload = mockServer.hot.send.mock.calls[0][1] as ServerLogPayload;
    expect(payload.args[0]).toEqual({
      API_KEY: '[REDACTED]',
      name: 'safe',
    });
  });

  it('redacts sensitive string values', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    console.log('SECRET_VALUE=abc123');

    const payload = mockServer.hot.send.mock.calls[0][1] as ServerLogPayload;
    expect(payload.args[0]).toBe('[REDACTED]');
  });

  it('includes timestamp in payload', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    const before = Date.now();
    console.log('timed');
    const after = Date.now();

    const payload = mockServer.hot.send.mock.calls[0][1] as ServerLogPayload;
    expect(payload.timestamp).toBeGreaterThanOrEqual(before);
    expect(payload.timestamp).toBeLessThanOrEqual(after);
  });

  it('handles non-serializable arguments gracefully', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    // Functions, symbols, bigints, etc.
    console.log(Symbol('test'), BigInt(42), () => {});

    const payload = mockServer.hot.send.mock.calls[0][1] as ServerLogPayload;
    expect(payload.args[0]).toBe('Symbol(test)');
    expect(payload.args[1]).toBe('42n');
    expect(payload.args[2]).toMatch(/\[Function/);
  });

  it('handles deeply nested objects with depth limit', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    // Create deeply nested object
    let obj: Record<string, unknown> = { value: 'deep' };
    for (let i = 0; i < 10; i++) {
      obj = { nested: obj };
    }
    console.log(obj);

    // Should not throw, and should have truncated deep levels
    expect(mockServer.hot.send).toHaveBeenCalledOnce();
  });

  it('only applies during dev (apply: serve)', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    expect(plugin.apply).toBe('serve');
  });

  it('does not break if hot.send throws', async () => {
    const { timberDevLogs } = await import('../packages/timber-app/src/plugins/dev-logs');
    const mockServer = createMockServer();
    mockServer.hot.send.mockImplementation(() => {
      throw new Error('WebSocket closed');
    });
    const ctx = { config: {}, routeTree: null, appDir: '/tmp/app', root: '/tmp', dev: true, buildManifest: null };

    const plugin = timberDevLogs(ctx as never);
    (plugin as { configureServer: (s: unknown) => void }).configureServer(mockServer);

    // Should not throw
    expect(() => console.log('safe')).not.toThrow();
  });
});
