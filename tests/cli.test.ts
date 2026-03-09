import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs } from '../packages/timber-app/src/cli';

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
  let mockCreateServer: ReturnType<typeof vi.fn>;
  let mockServer: { listen: ReturnType<typeof vi.fn>; printUrls: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockServer = {
      listen: vi.fn().mockResolvedValue(undefined),
      printUrls: vi.fn(),
    };
    mockCreateServer = vi.fn().mockResolvedValue(mockServer);
    vi.doMock('vite', () => ({ createServer: mockCreateServer }));
  });

  afterEach(() => {
    vi.doUnmock('vite');
  });

  it('dev starts Vite dev server', async () => {
    const { runDev } = await import('../packages/timber-app/src/cli');
    await runDev({});

    expect(mockCreateServer).toHaveBeenCalledOnce();
    expect(mockServer.listen).toHaveBeenCalledOnce();
    expect(mockServer.printUrls).toHaveBeenCalledOnce();
  });

  it('dev passes config path to createServer', async () => {
    const { runDev } = await import('../packages/timber-app/src/cli');
    await runDev({ config: 'custom.config.ts' });

    expect(mockCreateServer).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: 'custom.config.ts' })
    );
  });
});

// ─── build command ────────────────────────────────────────────────────────────

describe('runBuild', () => {
  let mockCreateBuilder: ReturnType<typeof vi.fn>;
  let mockBuilder: { buildApp: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockBuilder = {
      buildApp: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateBuilder = vi.fn().mockResolvedValue(mockBuilder);
    vi.doMock('vite', () => ({ createBuilder: mockCreateBuilder }));
  });

  afterEach(() => {
    vi.doUnmock('vite');
  });

  it('build produces output', async () => {
    const { runBuild } = await import('../packages/timber-app/src/cli');
    await runBuild({});

    expect(mockBuilder.buildApp).toHaveBeenCalledOnce();
  });

  it('build uses createBuilder', async () => {
    const { runBuild } = await import('../packages/timber-app/src/cli');
    await runBuild({});

    expect(mockCreateBuilder).toHaveBeenCalledOnce();
  });

  it('build passes config path', async () => {
    const { runBuild } = await import('../packages/timber-app/src/cli');
    await runBuild({ config: 'custom.config.ts' });

    expect(mockCreateBuilder).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: 'custom.config.ts' })
    );
  });
});

// ─── preview command ──────────────────────────────────────────────────────────

describe('runPreview', () => {
  let mockPreview: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPreview = vi.fn().mockResolvedValue({
      printUrls: vi.fn(),
    });
    vi.doMock('vite', () => ({ preview: mockPreview }));
  });

  afterEach(() => {
    vi.doUnmock('vite');
  });

  it('preview serves build', async () => {
    const { runPreview } = await import('../packages/timber-app/src/cli');
    await runPreview({});

    expect(mockPreview).toHaveBeenCalledOnce();
  });

  it('preview passes config path', async () => {
    const { runPreview } = await import('../packages/timber-app/src/cli');
    await runPreview({ config: 'custom.config.ts' });

    expect(mockPreview).toHaveBeenCalledWith(
      expect.objectContaining({ configFile: 'custom.config.ts' })
    );
  });
});

// ─── check command ────────────────────────────────────────────────────────────

describe('runCheck', () => {
  let mockExecFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecFile = vi
      .fn()
      .mockImplementation(
        (
          _cmd: string,
          _args: string[],
          callback: (err: Error | null, stdout: string, stderr: string) => void
        ) => {
          callback(null, '', '');
        }
      );
    vi.doMock('node:child_process', () => ({ execFile: mockExecFile }));
  });

  afterEach(() => {
    vi.doUnmock('node:child_process');
  });

  it('check validates without building', async () => {
    const { runCheck } = await import('../packages/timber-app/src/cli');
    await runCheck({});

    // check should run tsc, not createBuilder
    expect(mockExecFile).toHaveBeenCalled();
    const firstCall = mockExecFile.mock.calls[0];
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
