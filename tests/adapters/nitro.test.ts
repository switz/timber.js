import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TimberPlatformAdapter } from '../../packages/timber-app/src/adapters/types';

// Mock node:fs/promises at the module level for ESM compatibility
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
}));

// Mock the adapter module to replace runNitroBuild with a no-op.
// The adapter uses dynamic import('nitro') internally which can't be
// easily mocked from tests. Instead, we mock the adapter module itself
// and re-export everything except buildOutput behavior.
vi.mock('../../packages/timber-app/src/adapters/nitro', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../packages/timber-app/src/adapters/nitro')>();
  const originalNitro = original.nitro;
  return {
    ...original,
    nitro: (options?: Parameters<typeof originalNitro>[0]) => {
      const adapter = originalNitro(options);
      return {
        ...adapter,
        async buildOutput(config: any, buildDir: string) {
          // Run the original buildOutput but catch the Nitro build error
          // since we can't mock the dynamic import('nitro').
          // The file-writing parts use mocked fs, so they're fine.
          try {
            await adapter.buildOutput(config, buildDir);
          } catch {
            // Expected: runNitroBuild fails because nitro can't resolve
            // files on disk. The file-writing assertions still work because
            // mkdir/writeFile/cp are mocked and called before runNitroBuild.
          }
        },
      };
    },
  };
});

import { writeFile, mkdir, cp } from 'node:fs/promises';
import {
  nitro,
  generateNitroEntry,
  generateNitroConfig,
  generatePreviewScript,
  getPresetConfig,
  type NitroPreset,
} from '../../packages/timber-app/src/adapters/nitro';
import { generateCompressModule } from '../../packages/timber-app/src/adapters/compress-module';

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

  it('node-server preset supports early hints', () => {
    const config = getPresetConfig('node-server');
    expect(config.supportsEarlyHints).toBe(true);
  });

  it('bun preset supports early hints', () => {
    const config = getPresetConfig('bun');
    expect(config.supportsEarlyHints).toBe(true);
  });

  it('serverless presets do not support early hints', () => {
    const serverless: NitroPreset[] = [
      'vercel',
      'vercel-edge',
      'netlify',
      'netlify-edge',
      'aws-lambda',
      'deno-deploy',
      'azure-functions',
    ];
    for (const preset of serverless) {
      const config = getPresetConfig(preset);
      expect(config.supportsEarlyHints).toBe(false);
    }
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
      expect(typeof config.supportsEarlyHints).toBe('boolean');
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

  it('passes config programmatically to createNitro (no nitro.config.ts file)', async () => {
    const adapter = nitro({ preset: 'vercel' });
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    // nitro.config.ts is no longer written — config is passed programmatically
    const configCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('nitro.config.ts')
    );
    expect(configCall).toBeUndefined();
  });

  it('does not fail when client dir is missing (clientJavascript disabled)', async () => {
    mockCp.mockRejectedValueOnce(new Error('ENOENT'));
    const adapter = nitro({ preset: 'vercel' });

    await expect(
      adapter.buildOutput({ output: 'static', clientJavascriptDisabled: true }, '/tmp/build')
    ).resolves.not.toThrow();
  });

  it('writes _headers file in public directory for static asset caching', async () => {
    const adapter = nitro({ preset: 'netlify' });
    await adapter.buildOutput({ output: 'server' }, '/tmp/build');

    const headersCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('_headers')
    );
    expect(headersCall).toBeDefined();
    expect(headersCall![0]).toContain('public/_headers');
    expect(headersCall![1]).toContain('/assets/*');
    expect(headersCall![1]).toContain('immutable');
  });
});

// ─── Entry Generation ───────────────────────────────────────────────────────

describe('generateNitroEntry', () => {
  it('generates entry importing from rsc entry', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain('rsc/index.js');
  });

  it('uses h3 event handler', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain('defineEventHandler');
    // h3 v2: event.req is the Web Request, return response directly
    expect(entry).toContain('event.req');
    expect(entry).toContain('return compressResponse(webRequest, webResponse)');
  });

  it('imports from nitro/h3', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain("from 'nitro/h3'");
  });

  it('uses event.req for web request (h3 v2)', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain('event.req');
    expect(entry).toContain('handler(webRequest)');
    expect(entry).toContain('compressResponse(webRequest, webResponse)');
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

  it('does not include manifest init import by default', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).not.toContain('_timber-manifest-init');
  });

  it('includes manifest init import when hasManifestInit is true', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server', true);
    expect(entry).toContain("import './_timber-manifest-init.js'");
  });

  it('manifest init import comes before handler import', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server', true);
    const manifestIdx = entry.indexOf("import './_timber-manifest-init.js'");
    const handlerIdx = entry.indexOf('import { defineEventHandler');
    expect(manifestIdx).toBeLessThan(handlerIdx);
  });

  it('node-server entry includes early hints support', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    expect(entry).toContain('runWithEarlyHintsSender');
    expect(entry).toContain('writeEarlyHints');
    expect(entry).toContain('event.node?.res');
  });

  it('bun entry includes early hints support', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'bun');
    expect(entry).toContain('runWithEarlyHintsSender');
    expect(entry).toContain('writeEarlyHints');
  });

  it('vercel entry does not use early hints in handler call', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'vercel');
    expect(entry).not.toContain('writeEarlyHints');
  });

  it('serverless entries do not use early hints in handler call', () => {
    const presets: NitroPreset[] = ['netlify', 'aws-lambda', 'azure-functions'];
    for (const preset of presets) {
      const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', preset);
      expect(entry).not.toContain('writeEarlyHints');
    }
  });

  it('early hints sender wraps handler call', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    // The handler call should be wrapped in runWithEarlyHintsSender
    expect(entry).toContain('runWithEarlyHintsSender(earlyHintsSender, () => handler(webRequest))');
  });

  it('early hints sender catches writeEarlyHints errors', () => {
    const entry = generateNitroEntry('/tmp/build', '/tmp/build/nitro', 'node-server');
    // The writeEarlyHints call should be wrapped in try/catch
    expect(entry).toContain('try { nodeRes.writeEarlyHints');
    expect(entry).toContain('} catch {}');
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

  it('imports from nitro/config', () => {
    const config = generateNitroConfig('node-server');
    expect(config).toContain("from 'nitro/config'");
  });

  it('includes routeRules for hashed asset caching', () => {
    const config = generateNitroConfig('node-server');
    expect(config).toContain('routeRules');
    expect(config).toContain('/assets/**');
    expect(config).toContain('immutable');
  });

  it('user routeRules override default asset caching rules', () => {
    const config = generateNitroConfig('vercel', {
      routeRules: { '/api/**': { cors: true } },
    });
    // User override replaces the entire routeRules
    expect(config).toContain('/api/**');
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

// ─── Compression integration ────────────────────────────────────────────

describe('compression in generated code', () => {
  it('nitro entry imports compressResponse from _compress.mjs', () => {
    const entry = generateNitroEntry('/build', '/build/nitro', 'node-server');
    expect(entry).toContain("import { compressResponse } from './_compress.mjs'");
  });

  it('nitro entry applies compressResponse to the web response', () => {
    const entry = generateNitroEntry('/build', '/build/nitro', 'node-server');
    expect(entry).toContain('compressResponse(webRequest, webResponse)');
  });

  it('preview script imports compressResponse from _compress.mjs', () => {
    const script = generatePreviewScript('/build', 'node-server');
    expect(script).toContain("import('./_compress.mjs')");
  });

  it('preview script applies compressResponse to responses', () => {
    const script = generatePreviewScript('/build', 'node-server');
    expect(script).toContain('compressResponse(webRequest, rawResponse)');
  });

  it('generateCompressModule produces valid ESM with compressResponse export', () => {
    const mod = generateCompressModule();
    expect(mod).toContain('export function compressResponse');
    expect(mod).toContain("new CompressionStream('gzip')");
    // Brotli is intentionally not included — left to CDNs/reverse proxies
    expect(mod).not.toContain('createBrotliCompress');
    expect(mod).not.toContain('BROTLI_PARAM_QUALITY');
  });

  it('buildOutput writes _compress.mjs to nitro output dir', async () => {
    mockWriteFile.mockClear();
    const adapter = nitro({ preset: 'node-server' });
    await adapter.buildOutput({ output: 'server' }, '/build');
    const compressCall = mockWriteFile.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('_compress.mjs')
    );
    expect(compressCall).toBeTruthy();
    expect(compressCall![0]).toBe('/build/nitro/_compress.mjs');
  });
});
