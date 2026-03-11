import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TimberPlatformAdapter } from '../../packages/timber-app/src/adapters/types';

// Mock node:fs/promises at the module level for ESM compatibility
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
}));

import { writeFile, mkdir, cp } from 'node:fs/promises';
import {
  nitro,
  generateNitroEntry,
  generateNitroConfig,
  getPresetConfig,
  type NitroPreset,
} from '../../packages/timber-app/src/adapters/nitro';

const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockCp = vi.mocked(cp);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Adapter Interface ──────────────────────────────────────────────────────

describe('Nitro adapter interface', () => {
  it('defaults to node-server preset', () => {
    const adapter = nitro();
    expect(adapter.name).toBe('nitro-node-server');
  });

  it('includes preset in adapter name', () => {
    const adapter = nitro({ preset: 'vercel' });
    expect(adapter.name).toBe('nitro-vercel');
  });

  it('satisfies TimberPlatformAdapter', () => {
    const adapter: TimberPlatformAdapter = nitro({ preset: 'vercel' });
    expect(adapter.name).toBe('nitro-vercel');
    expect(typeof adapter.buildOutput).toBe('function');
  });
});

// ─── Preset Config ──────────────────────────────────────────────────────────

describe('preset config', () => {
  it('vercel preset has correct output dir', () => {
    const config = getPresetConfig('vercel');
    expect(config.outputDir).toBe('.vercel/output');
    expect(config.nitroPreset).toBe('vercel');
    expect(config.supportsWaitUntil).toBe(true);
  });

  it('vercel-edge preset supports waitUntil', () => {
    const config = getPresetConfig('vercel-edge');
    expect(config.supportsWaitUntil).toBe(true);
  });

  it('netlify preset does not support waitUntil', () => {
    const config = getPresetConfig('netlify');
    expect(config.supportsWaitUntil).toBe(false);
  });

  it('netlify-edge preset supports waitUntil', () => {
    const config = getPresetConfig('netlify-edge');
    expect(config.supportsWaitUntil).toBe(true);
  });

  it('aws-lambda preset does not support waitUntil', () => {
    const config = getPresetConfig('aws-lambda');
    expect(config.supportsWaitUntil).toBe(false);
  });

  it('deno-deploy preset supports waitUntil', () => {
    const config = getPresetConfig('deno-deploy');
    expect(config.supportsWaitUntil).toBe(true);
  });

  it('azure-functions preset does not support waitUntil', () => {
    const config = getPresetConfig('azure-functions');
    expect(config.supportsWaitUntil).toBe(false);
  });

  it('node-server preset supports waitUntil', () => {
    const config = getPresetConfig('node-server');
    expect(config.supportsWaitUntil).toBe(true);
  });

  it('bun preset supports waitUntil', () => {
    const config = getPresetConfig('bun');
    expect(config.supportsWaitUntil).toBe(true);
    expect(config.nitroPreset).toBe('bun');
    expect(config.outputDir).toBe('.output');
  });

  it('all presets have required fields', () => {
    const presets: NitroPreset[] = [
      'vercel',
      'vercel-edge',
      'netlify',
      'netlify-edge',
      'aws-lambda',
      'deno-deploy',
      'azure-functions',
      'node-server',
      'bun',
    ];

    for (const preset of presets) {
      const config = getPresetConfig(preset);
      expect(config.nitroPreset).toBeTruthy();
      expect(config.outputDir).toBeTruthy();
      expect(typeof config.supportsWaitUntil).toBe('boolean');
      expect(config.runtimeName).toBeTruthy();
    }
  });
});

// ─── waitUntil ──────────────────────────────────────────────────────────────

describe('waitUntil', () => {
  it('provides waitUntil for presets that support it', () => {
    const adapter = nitro({ preset: 'vercel' });
    expect(typeof adapter.waitUntil).toBe('function');
  });

  it('omits waitUntil for presets that do not support it', () => {
    const adapter = nitro({ preset: 'netlify' });
    expect(adapter.waitUntil).toBeUndefined();
  });

  it('waitUntil collects promises without throwing', () => {
    const adapter = nitro({ preset: 'vercel' });
    adapter.waitUntil!(Promise.resolve('ok'));
    adapter.waitUntil!(Promise.resolve('also ok'));
    expect(true).toBe(true);
  });

  it('waitUntil logs rejected promises', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter = nitro({ preset: 'deno-deploy' });

    adapter.waitUntil!(Promise.reject(new Error('bg task failed')));

    // Wait for the rejection handler to fire
    await new Promise((r) => setTimeout(r, 10));

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[timber]'),
      expect.any(Error)
    );

    consoleError.mockRestore();
  });
});

// ─── Build Output ───────────────────────────────────────────────────────────

describe('buildOutput', () => {
  it('creates output directory', async () => {
    const adapter = nitro({ preset: 'vercel' });
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('nitro'), {
      recursive: true,
    });
  });

  it('copies client assets to public directory', async () => {
    const adapter = nitro({ preset: 'netlify' });
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    expect(mockCp).toHaveBeenCalledWith(
      expect.stringContaining('client'),
      expect.stringContaining('public'),
      { recursive: true }
    );
  });

  it('writes entry file', async () => {
    const adapter = nitro({ preset: 'vercel' });
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    const entryCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('entry.ts')
    );
    expect(entryCall).toBeDefined();
  });

  it('writes nitro config file', async () => {
    const adapter = nitro({ preset: 'vercel' });
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    const configCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('nitro.config.ts')
    );
    expect(configCall).toBeDefined();
  });

  it('does not fail when client dir is missing (static+noJS)', async () => {
    mockCp.mockRejectedValueOnce(new Error('ENOENT'));
    const adapter = nitro({ preset: 'vercel' });

    await expect(
      adapter.buildOutput({ output: 'static', static: { noJS: true } }, '/tmp/build')
    ).resolves.not.toThrow();
  });
});

// ─── Entry Generation ───────────────────────────────────────────────────────

describe('generateNitroEntry', () => {
  it('generates entry importing from server entry', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain('server/entry.js');
  });

  it('uses h3 event handler', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain('defineEventHandler');
    expect(entry).toContain('toWebRequest');
    expect(entry).toContain('sendWebResponse');
  });

  it('imports from h3', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain("from 'h3'");
  });

  it('converts web request and sends web response', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain('toWebRequest(event)');
    expect(entry).toContain('handler(webRequest)');
    expect(entry).toContain('sendWebResponse(event, webResponse)');
  });

  it('sets TIMBER_RUNTIME for node-server preset', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain("process.env.TIMBER_RUNTIME = 'node-server'");
  });

  it('sets TIMBER_RUNTIME for vercel preset', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'vercel');
    expect(entry).toContain("process.env.TIMBER_RUNTIME = 'vercel'");
  });

  it('sets TIMBER_RUNTIME for bun preset', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'bun');
    expect(entry).toContain("process.env.TIMBER_RUNTIME = 'bun'");
  });
});

// ─── Config Generation ──────────────────────────────────────────────────────

describe('generateNitroConfig', () => {
  it('generates config with vercel preset', () => {
    const config = generateNitroConfig('vercel');
    expect(config).toContain('defineNitroConfig');
    expect(config).toContain('"preset": "vercel"');
    expect(config).toContain('.vercel/output');
  });

  it('generates config with netlify preset', () => {
    const config = generateNitroConfig('netlify');
    expect(config).toContain('"preset": "netlify"');
    expect(config).toContain('.netlify/functions-internal');
  });

  it('generates config with aws-lambda preset', () => {
    const config = generateNitroConfig('aws-lambda');
    expect(config).toContain('"preset": "aws-lambda"');
  });

  it('generates config with deno-deploy preset', () => {
    const config = generateNitroConfig('deno-deploy');
    expect(config).toContain('"preset": "deno-deploy"');
  });

  it('includes vercel-specific extra config', () => {
    const config = generateNitroConfig('vercel');
    expect(config).toContain('maxDuration');
  });

  it('merges user config overrides', () => {
    const config = generateNitroConfig('vercel', {
      minify: true,
      routeRules: { '/api/**': { cors: true } },
    });
    expect(config).toContain('"minify": true');
    expect(config).toContain('routeRules');
  });

  it('user config overrides preset defaults', () => {
    // Override the output dir
    const config = generateNitroConfig('vercel', {
      output: { dir: '/custom/output' },
    });
    expect(config).toContain('/custom/output');
  });

  it('imports from nitropack/config', () => {
    const config = generateNitroConfig('node-server');
    expect(config).toContain("from 'nitropack/config'");
  });
});

// ─── Options ────────────────────────────────────────────────────────────────

describe('options', () => {
  it('defaults to node-server preset', () => {
    const adapter = nitro();
    expect(adapter.name).toBe('nitro-node-server');
  });

  it('accepts vercel preset', () => {
    const adapter = nitro({ preset: 'vercel' });
    expect(adapter.name).toBe('nitro-vercel');
  });

  it('accepts netlify preset', () => {
    const adapter = nitro({ preset: 'netlify' });
    expect(adapter.name).toBe('nitro-netlify');
  });

  it('accepts custom nitroConfig', () => {
    const adapter = nitro({
      preset: 'vercel',
      nitroConfig: { minify: true },
    });
    expect(adapter.name).toBe('nitro-vercel');
  });
});
