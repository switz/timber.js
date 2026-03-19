import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Top-level mocks ─────────────────────────────────────────────────────────
// vi.mock is hoisted and reliably intercepts both static and dynamic imports.
// vi.doMock + vi.resetModules + dynamic import() is flaky in forks pool mode.

vi.mock('vite', () => ({
  createServer: vi.fn(),
  createBuilder: vi.fn(),
  preview: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { createServer, createBuilder, preview } from 'vite';
import { execFile } from 'node:child_process';
import { parseArgs, runDev, runBuild, runPreview, runCheck } from '../packages/timber-app/src/cli';

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = {
      listen: vi.fn().mockResolvedValue(undefined),
      printUrls: vi.fn(),
    };
    vi.mocked(createServer).mockResolvedValue(mockServer as never);
  });

  it('dev starts Vite dev server', async () => {
    await runDev({});

    expect(createServer).toHaveBeenCalledOnce();
    expect(mockServer.listen).toHaveBeenCalledOnce();
    expect(mockServer.printUrls).toHaveBeenCalledOnce();
  });

  it('dev passes config path to createServer', async () => {
    await runDev({ config: 'custom.config.ts' });

    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: 'custom.config.ts' })
    );
  });
});

// ─── build command ────────────────────────────────────────────────────────────

describe('runBuild', () => {
  let mockBuilder: { buildApp: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuilder = {
      buildApp: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(createBuilder).mockResolvedValue(mockBuilder as never);
  });

  it('build produces output', async () => {
    await runBuild({});

    expect(mockBuilder.buildApp).toHaveBeenCalledOnce();
  });

  it('build uses createBuilder', async () => {
    await runBuild({});

    expect(createBuilder).toHaveBeenCalledOnce();
  });

  it('build passes config path', async () => {
    await runBuild({ config: 'custom.config.ts' });

    expect(createBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: 'custom.config.ts' })
    );
  });
});

// ─── preview command ──────────────────────────────────────────────────────────

describe('runPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // existsSync returns false by default (from top-level mock), so loadTimberConfig
    // finds no config and falls through to Vite preview.
    vi.mocked(preview).mockResolvedValue({ printUrls: vi.fn() } as never);
  });

  it('preview serves build', async () => {
    await runPreview({});

    expect(preview).toHaveBeenCalledOnce();
  });

  it('preview passes config path', async () => {
    await runPreview({ config: 'custom.config.ts' });

    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: 'custom.config.ts' })
    );
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

    // check should run tsc, not createBuilder
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
