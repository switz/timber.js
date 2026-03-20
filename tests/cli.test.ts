import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Dynamic `await import('vite')` inside cli.ts bypasses vi.mock in Vitest's
// forks pool. Instead we use dependency injection via the _deps parameter.

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import {
  parseArgs,
  runDev,
  runBuild,
  runPreview,
  runCheck,
  resolvePreviewStrategy,
} from '../packages/timber-app/src/cli';
import type { ViteDeps } from '../packages/timber-app/src/cli';

// ─── parseArgs ────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses dev command with no flags', () => {
    const result = parseArgs(['dev']);
    expect(result).toEqual({ command: 'dev', config: undefined });
  });

  it('parses build command', () => {
    const result = parseArgs(['build']);
    expect(result).toEqual({ command: 'build', config: undefined });
  });

  it('parses preview command', () => {
    const result = parseArgs(['preview']);
    expect(result).toEqual({ command: 'preview', config: undefined });
  });

  it('parses check command', () => {
    const result = parseArgs(['check']);
    expect(result).toEqual({ command: 'check', config: undefined });
  });

  it('parses --config flag', () => {
    const result = parseArgs(['dev', '--config', 'custom.config.ts']);
    expect(result).toEqual({ command: 'dev', config: 'custom.config.ts' });
  });

  it('parses -c shorthand for config', () => {
    const result = parseArgs(['build', '-c', 'my.config.ts']);
    expect(result).toEqual({ command: 'build', config: 'my.config.ts' });
  });

  it('throws on unknown command', () => {
    expect(() => parseArgs(['unknown'])).toThrow('Unknown command: unknown');
  });

  it('throws on no command', () => {
    expect(() => parseArgs([])).toThrow('No command provided');
  });
});

// ─── dev command ──────────────────────────────────────────────────────────────

describe('runDev', () => {
  let mockServer: { listen: ReturnType<typeof vi.fn>; printUrls: ReturnType<typeof vi.fn> };
  let mockCreateServer: ReturnType<typeof vi.fn>;
  let deps: ViteDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = {
      listen: vi.fn().mockResolvedValue(undefined),
      printUrls: vi.fn(),
    };
    mockCreateServer = vi.fn().mockResolvedValue(mockServer);
    deps = { createServer: mockCreateServer as never };
  });

  it('dev starts Vite dev server', async () => {
    await runDev({}, deps);

    expect(mockCreateServer).toHaveBeenCalledOnce();
    expect(mockServer.listen).toHaveBeenCalledOnce();
    expect(mockServer.printUrls).toHaveBeenCalledOnce();
  });

  it('dev passes config path to createServer', async () => {
    await runDev({ config: 'custom.config.ts' }, deps);

    expect(mockCreateServer).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: 'custom.config.ts' })
    );
  });
});

// ─── build command ────────────────────────────────────────────────────────────

describe('runBuild', () => {
  let mockBuilder: { buildApp: ReturnType<typeof vi.fn> };
  let mockCreateBuilder: ReturnType<typeof vi.fn>;
  let deps: ViteDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuilder = {
      buildApp: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateBuilder = vi.fn().mockResolvedValue(mockBuilder);
    deps = { createBuilder: mockCreateBuilder as never };
  });

  it('build produces output', async () => {
    await runBuild({}, deps);

    expect(mockBuilder.buildApp).toHaveBeenCalledOnce();
  });

  it('build uses createBuilder', async () => {
    await runBuild({}, deps);

    expect(mockCreateBuilder).toHaveBeenCalledOnce();
  });

  it('build passes config path', async () => {
    await runBuild({ config: 'custom.config.ts' }, deps);

    expect(mockCreateBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: 'custom.config.ts' })
    );
  });
});

// ─── preview command ──────────────────────────────────────────────────────────

describe('runPreview', () => {
  let mockPreview: ReturnType<typeof vi.fn>;
  let deps: ViteDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    // existsSync returns false by default (from top-level mock), so loadTimberConfig
    // finds no config and falls through to Vite preview.
    mockPreview = vi.fn().mockResolvedValue({ printUrls: vi.fn() });
    deps = { preview: mockPreview as never };
  });

  it('preview serves build', async () => {
    await runPreview({}, deps);

    expect(mockPreview).toHaveBeenCalledOnce();
  });

  it('preview passes config path', async () => {
    await runPreview({ config: 'custom.config.ts' }, deps);

    expect(mockPreview).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: 'custom.config.ts' })
    );
  });
});

// ─── resolvePreviewStrategy ───────────────────────────────────────────────────

describe('resolvePreviewStrategy', () => {
  it('returns vite when no adapter', () => {
    expect(resolvePreviewStrategy(undefined)).toBe('vite');
  });

  it('returns vite when adapter has no preview', () => {
    expect(resolvePreviewStrategy({ name: 'test' } as never)).toBe('vite');
  });

  it('returns adapter when adapter has preview', () => {
    expect(
      resolvePreviewStrategy({ name: 'test', preview: vi.fn() } as never)
    ).toBe('adapter');
  });
});

// ─── check command ────────────────────────────────────────────────────────────

describe('runCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execFile).mockImplementation(((
      _cmd: string,
      _args: string[],
      callback: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
      callback(null, '', '');
    }) as never);
  });

  it('check validates without building', async () => {
    await runCheck({});

    // check should run tsgo, not createBuilder
    expect(execFile).toHaveBeenCalled();
    const firstCall = vi.mocked(execFile).mock.calls[0];
    expect(firstCall[0]).toContain('tsgo');
  });
});

// ─── config flag ──────────────────────────────────────────────────────────────

describe('config flag', () => {
  it('--config is accepted by all commands', () => {
    for (const cmd of ['dev', 'build', 'preview', 'check'] as const) {
      const result = parseArgs([cmd, '--config', 'path/to/config.ts']);
      expect(result.config).toBe('path/to/config.ts');
    }
  });
});
