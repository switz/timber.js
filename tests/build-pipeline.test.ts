/**
 * End-to-end build pipeline validation — adapter output tests.
 *
 * Tests the adapter step (step 5) of the build pipeline by running
 * adapter buildOutput() against mock build directories and validating
 * the output artifacts for Cloudflare and Nitro adapters.
 *
 * Design docs: 18-build-system.md §"Build Pipeline", 25-production-deployments.md
 * Task: timber-d9a
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cloudflare,
  generateWorkerEntry,
  generateWranglerConfig,
} from '../packages/timber-app/src/adapters/cloudflare';
import {
  nitro,
  generateNitroEntry,
  generateNitroConfig,
  getPresetConfig,
} from '../packages/timber-app/src/adapters/nitro';
import type { TimberConfig } from '../packages/timber-app/src/adapters/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Create a mock build directory with the structure produced by steps 1-4. */
async function createMockBuildDir(baseDir: string): Promise<string> {
  const buildDir = join(baseDir, '.timber', 'build');

  // Server output (RSC build step)
  const serverDir = join(buildDir, 'server');
  await mkdir(serverDir, { recursive: true });
  await writeFile(
    join(serverDir, 'entry.js'),
    'export const handler = async (req) => new Response("ok");'
  );

  // RSC output
  const rscDir = join(buildDir, 'rsc');
  await mkdir(rscDir, { recursive: true });
  await writeFile(join(rscDir, 'index.js'), 'export default async (req) => new Response("ok");');

  // SSR output
  const ssrDir = join(buildDir, 'ssr');
  await mkdir(ssrDir, { recursive: true });
  await writeFile(join(ssrDir, 'index.js'), '// ssr entry');

  // Client output (client build step)
  const clientDir = join(buildDir, 'client');
  const assetsDir = join(clientDir, 'assets');
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(assetsDir, 'layout-abc123.js'), '// layout chunk');
  await writeFile(join(assetsDir, 'page-def456.js'), '// page chunk');
  await writeFile(join(assetsDir, 'root-ghi789.css'), '/* root styles */');
  await writeFile(join(assetsDir, 'browser-entry-xyz.js'), '// browser entry');

  return buildDir;
}

const SERVER_CONFIG: TimberConfig = { output: 'server' };
const STATIC_CONFIG: TimberConfig = { output: 'static' };
const STATIC_NOJS_CONFIG: TimberConfig = { output: 'static', clientJavascriptDisabled: true };

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'timber-build-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Cloudflare adapter build ─────────────────────────────────────────────

describe('cloudflare build', () => {
  it('produces _worker.js, wrangler.jsonc, and static/ directory', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = cloudflare();

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const outDir = join(buildDir, 'cloudflare');
    const files = await readdir(outDir);

    expect(files).toContain('_worker.js');
    expect(files).toContain('wrangler.jsonc');
    expect(files).toContain('static');
  });

  it('_worker.js imports rsc entry and sets TIMBER_RUNTIME', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = cloudflare();

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const workerEntry = await readFile(join(buildDir, 'cloudflare', '_worker.js'), 'utf-8');
    expect(workerEntry).toContain("process.env.TIMBER_RUNTIME = 'cloudflare'");
    expect(workerEntry).toContain('rsc/index.js');
    expect(workerEntry).toContain('export default { fetch: handler }');
  });

  it('wrangler.jsonc contains nodejs_compat flag', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = cloudflare();

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const wranglerRaw = await readFile(join(buildDir, 'cloudflare', 'wrangler.jsonc'), 'utf-8');
    const wrangler = JSON.parse(wranglerRaw);

    expect(wrangler.compatibility_flags).toContain('nodejs_compat');
    expect(wrangler.main).toBe('_worker.js');
    expect(wrangler.no_bundle).toBe(true);
    expect(wrangler.find_additional_modules).toBe(true);
    expect(wrangler.rules).toEqual([{ type: 'ESModule', globs: ['**/*.js'] }]);
    expect(wrangler.assets).toEqual({ directory: './static' });
  });

  it('wrangler.jsonc has compatibility_date in YYYY-MM-DD format', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = cloudflare();

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const wranglerRaw = await readFile(join(buildDir, 'cloudflare', 'wrangler.jsonc'), 'utf-8');
    const wrangler = JSON.parse(wranglerRaw);

    expect(wrangler.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('copies client assets to static/ directory', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = cloudflare();

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const staticAssets = join(buildDir, 'cloudflare', 'static', 'assets');
    const files = await readdir(staticAssets);
    expect(files).toContain('layout-abc123.js');
    expect(files).toContain('root-ghi789.css');
    expect(files).toContain('browser-entry-xyz.js');
  });

  it('custom compatibility flags are passed through', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {
      compatibilityFlags: ['nodejs_compat', 'streams_enable_constructors'],
    });

    expect(config.compatibility_flags).toEqual(['nodejs_compat', 'streams_enable_constructors']);
  });

  it('custom wrangler fields are merged', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {
      wrangler: { name: 'my-app', kv_namespaces: [{ binding: 'MY_KV', id: 'abc' }] },
    });

    expect(config.name).toBe('my-app');
    expect(config.kv_namespaces).toEqual([{ binding: 'MY_KV', id: 'abc' }]);
  });

  it('adapter has waitUntil method', () => {
    const adapter = cloudflare();
    expect(adapter.waitUntil).toBeDefined();
    expect(typeof adapter.waitUntil).toBe('function');
  });
});

// ─── Nitro node-server build ──────────────────────────────────────────────

describe('nitro node-server build', () => {
  it('produces entry.ts and nitro.config.ts', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = nitro({ preset: 'node-server' });

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const outDir = join(buildDir, 'nitro');
    const files = await readdir(outDir);

    expect(files).toContain('entry.ts');
    expect(files).toContain('nitro.config.ts');
    expect(files).toContain('public');
  });

  it('entry.ts imports h3 and sets TIMBER_RUNTIME', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = nitro({ preset: 'node-server' });

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const entry = await readFile(join(buildDir, 'nitro', 'entry.ts'), 'utf-8');
    expect(entry).toContain("process.env.TIMBER_RUNTIME = 'node-server'");
    expect(entry).toContain('defineEventHandler');
    expect(entry).toContain('toWebRequest');
    expect(entry).toContain('sendWebResponse');
    expect(entry).toContain('rsc/index.js');
  });

  it('nitro.config.ts uses node-server preset', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = nitro({ preset: 'node-server' });

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const config = await readFile(join(buildDir, 'nitro', 'nitro.config.ts'), 'utf-8');
    expect(config).toContain('defineNitroConfig');
    expect(config).toContain('"node-server"');
  });

  it('copies client assets to public/ directory', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = nitro({ preset: 'node-server' });

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const publicAssets = join(buildDir, 'nitro', 'public', 'assets');
    const files = await readdir(publicAssets);
    expect(files).toContain('layout-abc123.js');
    expect(files).toContain('root-ghi789.css');
  });

  it('adapter name includes preset', () => {
    const adapter = nitro({ preset: 'node-server' });
    expect(adapter.name).toBe('nitro-node-server');
  });

  it('node-server supports waitUntil', () => {
    const adapter = nitro({ preset: 'node-server' });
    expect(adapter.waitUntil).toBeDefined();
  });

  it('preset config has correct runtime name', () => {
    const config = getPresetConfig('node-server');
    expect(config.runtimeName).toBe('node-server');
    expect(config.supportsWaitUntil).toBe(true);
  });
});

// ─── Nitro vercel build ───────────────────────────────────────────────────

describe('nitro vercel build', () => {
  it('produces entry.ts and nitro.config.ts', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = nitro({ preset: 'vercel' });

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const outDir = join(buildDir, 'nitro');
    const files = await readdir(outDir);

    expect(files).toContain('entry.ts');
    expect(files).toContain('nitro.config.ts');
  });

  it('entry.ts sets TIMBER_RUNTIME to vercel', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = nitro({ preset: 'vercel' });

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const entry = await readFile(join(buildDir, 'nitro', 'entry.ts'), 'utf-8');
    expect(entry).toContain("process.env.TIMBER_RUNTIME = 'vercel'");
  });

  it('nitro.config.ts uses vercel preset with maxDuration', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = nitro({ preset: 'vercel' });

    await adapter.buildOutput(SERVER_CONFIG, buildDir);

    const config = await readFile(join(buildDir, 'nitro', 'nitro.config.ts'), 'utf-8');
    expect(config).toContain('"vercel"');
    expect(config).toContain('maxDuration');
  });

  it('vercel preset output dir is .vercel/output', () => {
    const config = getPresetConfig('vercel');
    expect(config.outputDir).toBe('.vercel/output');
    expect(config.supportsWaitUntil).toBe(true);
    expect(config.runtimeName).toBe('vercel');
  });

  it('custom nitroConfig is merged', () => {
    const configStr = generateNitroConfig('vercel', {
      vercel: { functions: { maxDuration: 60, regions: ['iad1'] } },
    });

    expect(configStr).toContain('maxDuration');
    expect(configStr).toContain('iad1');
  });

  it('adapter name includes vercel preset', () => {
    const adapter = nitro({ preset: 'vercel' });
    expect(adapter.name).toBe('nitro-vercel');
  });
});

// ─── All Nitro presets ────────────────────────────────────────────────────

describe('nitro preset coverage', () => {
  const presets = [
    'vercel',
    'vercel-edge',
    'netlify',
    'netlify-edge',
    'aws-lambda',
    'deno-deploy',
    'azure-functions',
    'node-server',
    'bun',
  ] as const;

  for (const preset of presets) {
    it(`${preset}: generates valid entry with correct TIMBER_RUNTIME`, () => {
      const entry = generateNitroEntry('/build', '/build/nitro', preset);
      const expectedRuntime = getPresetConfig(preset).runtimeName;

      expect(entry).toContain(`process.env.TIMBER_RUNTIME = '${expectedRuntime}'`);
      expect(entry).toContain('defineEventHandler');
      expect(entry).toContain('rsc/index.js');
    });

    it(`${preset}: generates valid nitro config`, () => {
      const config = generateNitroConfig(preset);
      expect(config).toContain('defineNitroConfig');
      expect(config).toContain(`"${preset}"`);
    });
  }

  it('presets without waitUntil have undefined waitUntil', () => {
    const noWaitUntil = ['netlify', 'aws-lambda', 'azure-functions'] as const;
    for (const preset of noWaitUntil) {
      const adapter = nitro({ preset });
      expect(adapter.waitUntil).toBeUndefined();
    }
  });

  it('presets with waitUntil have defined waitUntil', () => {
    const withWaitUntil = [
      'vercel',
      'vercel-edge',
      'netlify-edge',
      'deno-deploy',
      'node-server',
      'bun',
    ] as const;
    for (const preset of withWaitUntil) {
      const adapter = nitro({ preset });
      expect(adapter.waitUntil).toBeDefined();
    }
  });
});

// ─── Static export ────────────────────────────────────────────────────────

describe('static export', () => {
  it('cloudflare adapter works with static config', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = cloudflare();

    await adapter.buildOutput(STATIC_CONFIG, buildDir);

    const outDir = join(buildDir, 'cloudflare');
    const files = await readdir(outDir);
    expect(files).toContain('_worker.js');
    expect(files).toContain('static');
  });

  it('nitro adapter works with static config', async () => {
    const buildDir = await createMockBuildDir(tempDir);
    const adapter = nitro({ preset: 'node-server' });

    await adapter.buildOutput(STATIC_CONFIG, buildDir);

    const outDir = join(buildDir, 'nitro');
    const files = await readdir(outDir);
    expect(files).toContain('entry.ts');
    expect(files).toContain('public');
  });

  it('static+noClientJavascript mode gracefully handles missing client dir', async () => {
    // Create a build dir without client/ directory (noClientJavascript mode)
    const buildDir = join(tempDir, '.timber', 'build');
    const serverDir = join(buildDir, 'server');
    await mkdir(serverDir, { recursive: true });
    await writeFile(
      join(serverDir, 'entry.js'),
      'export const handler = async () => new Response("ok");'
    );

    // RSC and SSR bundles are still required
    const rscDir = join(buildDir, 'rsc');
    await mkdir(rscDir, { recursive: true });
    await writeFile(join(rscDir, 'index.js'), 'export default async (req) => new Response("ok");');
    const ssrDir = join(buildDir, 'ssr');
    await mkdir(ssrDir, { recursive: true });
    await writeFile(join(ssrDir, 'index.js'), '// ssr entry');

    const adapter = cloudflare();
    // Should not throw even without client/ directory
    await adapter.buildOutput(STATIC_NOJS_CONFIG, buildDir);

    const outDir = join(buildDir, 'cloudflare');
    const files = await readdir(outDir);
    expect(files).toContain('_worker.js');
    expect(files).toContain('wrangler.jsonc');
  });
});

// ─── Worker entry generation ──────────────────────────────────────────────

describe('generateWorkerEntry', () => {
  it('uses correct relative path to rsc entry', () => {
    const entry = generateWorkerEntry(
      '/project/.timber/build/cloudflare',
      '/project/.timber/build/cloudflare'
    );
    expect(entry).toContain('rsc/index.js');
  });

  it('includes TIMBER_RUNTIME assignment', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).toContain("process.env.TIMBER_RUNTIME = 'cloudflare'");
  });

  it('exports fetch handler directly', () => {
    const entry = generateWorkerEntry('/build', '/build/out');
    expect(entry).toContain('export default { fetch: handler }');
  });
});

// ─── Nitro entry generation ──────────────────────────────────────────────

describe('generateNitroEntry', () => {
  it('uses correct relative path to server entry', () => {
    const entry = generateNitroEntry(
      '/project/.timber/build',
      '/project/.timber/build/nitro',
      'node-server'
    );
    expect(entry).toContain('../rsc/index.js');
  });

  it('bridges h3 event to web request/response', () => {
    const entry = generateNitroEntry('/build', '/build/nitro', 'vercel');
    expect(entry).toContain('toWebRequest(event)');
    expect(entry).toContain('sendWebResponse(event, finalResponse)');
  });
});

// ─── Default adapter ──────────────────────────────────────────────────────

describe('adapter defaults', () => {
  it('nitro defaults to node-server preset', () => {
    const adapter = nitro();
    expect(adapter.name).toBe('nitro-node-server');
  });

  it('cloudflare defaults to nodejs_compat', () => {
    const config = generateWranglerConfig(SERVER_CONFIG, {});
    expect(config.compatibility_flags).toEqual(['nodejs_compat']);
  });
});
