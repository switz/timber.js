/**
 * Preview command validation tests.
 *
 * Tests that `timber preview` correctly delegates to adapter-specific preview
 * methods when available and falls back to Vite's built-in preview server
 * when no adapter preview is provided.
 *
 * These tests validate:
 * - runPreview checks for adapter.preview() before falling back to Vite
 * - Cloudflare adapter provides a preview() method using wrangler
 * - Nitro node-server adapter provides a preview() method
 * - Adapters without preview() fall back gracefully
 * - Preview command generation produces correct CLI commands
 *
 * Design docs: design/11-platform.md, design/25-production-deployments.md
 * Task: timber-j87
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cloudflare, generatePreviewCommand } from '../packages/timber-app/src/adapters/cloudflare';
import { nitro, generateNitroPreviewCommand } from '../packages/timber-app/src/adapters/nitro';
import type { TimberPlatformAdapter } from '../packages/timber-app/src/adapters/types';
import { resolvePreviewStrategy } from '../packages/timber-app/src/cli';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'timber-preview-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Adapter preview detection ───────────────────────────────────────────

describe('adapter preview', () => {
  it('cloudflare adapter has a preview method', () => {
    const adapter = cloudflare();
    expect(adapter.preview).toBeDefined();
    expect(typeof adapter.preview).toBe('function');
  });

  it('nitro node-server adapter has a preview method', () => {
    const adapter = nitro({ preset: 'node-server' });
    expect(adapter.preview).toBeDefined();
    expect(typeof adapter.preview).toBe('function');
  });

  it('nitro bun adapter has a preview method', () => {
    const adapter = nitro({ preset: 'bun' });
    expect(adapter.preview).toBeDefined();
    expect(typeof adapter.preview).toBe('function');
  });

  it('nitro vercel adapter has no preview method', () => {
    const adapter = nitro({ preset: 'vercel' });
    expect(adapter.preview).toBeUndefined();
  });

  it('nitro vercel-edge adapter has no preview method', () => {
    const adapter = nitro({ preset: 'vercel-edge' });
    expect(adapter.preview).toBeUndefined();
  });

  it('nitro netlify adapter has no preview method', () => {
    const adapter = nitro({ preset: 'netlify' });
    expect(adapter.preview).toBeUndefined();
  });

  it('nitro aws-lambda adapter has no preview method', () => {
    const adapter = nitro({ preset: 'aws-lambda' });
    expect(adapter.preview).toBeUndefined();
  });

  it('nitro azure-functions adapter has no preview method', () => {
    const adapter = nitro({ preset: 'azure-functions' });
    expect(adapter.preview).toBeUndefined();
  });

  it('nitro deno-deploy adapter has no preview method', () => {
    const adapter = nitro({ preset: 'deno-deploy' });
    expect(adapter.preview).toBeUndefined();
  });
});

// ─── Vite fallback ───────────────────────────────────────────────────────

describe('vite fallback', () => {
  it('resolvePreviewStrategy returns "adapter" when adapter has preview', () => {
    const adapter: TimberPlatformAdapter = {
      name: 'test',
      async buildOutput() {},
      async preview() {},
    };
    const result = resolvePreviewStrategy(adapter);
    expect(result).toBe('adapter');
  });

  it('resolvePreviewStrategy returns "vite" when adapter has no preview', () => {
    const adapter: TimberPlatformAdapter = {
      name: 'test',
      async buildOutput() {},
    };
    const result = resolvePreviewStrategy(adapter);
    expect(result).toBe('vite');
  });

  it('resolvePreviewStrategy returns "vite" when adapter is undefined', () => {
    const result = resolvePreviewStrategy(undefined);
    expect(result).toBe('vite');
  });
});

// ─── Cloudflare preview command ──────────────────────────────────────────

describe('cloudflare preview', () => {
  it('generates wrangler dev --local command', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generatePreviewCommand(buildDir);
    expect(cmd.command).toBe('wrangler');
    expect(cmd.args).toContain('dev');
    expect(cmd.args).toContain('--local');
  });

  it('points to the cloudflare output directory', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generatePreviewCommand(buildDir);
    // wrangler dev uses --config to point to the generated wrangler.jsonc
    expect(cmd.args).toContain('--config');
    expect(cmd.args.some((a: string) => a.includes('cloudflare/wrangler.jsonc'))).toBe(true);
  });

  it('sets cwd to cloudflare output directory', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generatePreviewCommand(buildDir);
    expect(cmd.cwd).toBe(join(buildDir, 'cloudflare'));
  });
});

// ─── Nitro preview command ───────────────────────────────────────────────

describe('nitro preview', () => {
  it('node-server generates node command', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generateNitroPreviewCommand(buildDir, 'node-server');
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe('node');
    expect(cmd!.args.some((a: string) => a.includes('entry'))).toBe(true);
  });

  it('bun preset generates bun command', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generateNitroPreviewCommand(buildDir, 'bun');
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe('bun');
    expect(cmd!.args.some((a: string) => a.includes('entry'))).toBe(true);
  });

  it('node-server sets cwd to nitro output directory', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generateNitroPreviewCommand(buildDir, 'node-server');
    expect(cmd).not.toBeNull();
    expect(cmd!.cwd).toBe(join(buildDir, 'nitro'));
  });

  it('netlify-edge has no preview command', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generateNitroPreviewCommand(buildDir, 'netlify-edge');
    expect(cmd).toBeNull();
  });

  it('vercel has no preview command', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generateNitroPreviewCommand(buildDir, 'vercel');
    expect(cmd).toBeNull();
  });

  it('aws-lambda has no preview command', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generateNitroPreviewCommand(buildDir, 'aws-lambda');
    expect(cmd).toBeNull();
  });
});

// ─── Preview with build output ───────────────────────────────────────────

describe('preview with build output', () => {
  it('cloudflare preview requires wrangler.jsonc in build output', async () => {
    const buildDir = join(tempDir, '.timber', 'build');
    const cfDir = join(buildDir, 'cloudflare');
    await mkdir(cfDir, { recursive: true });
    await writeFile(join(cfDir, 'wrangler.jsonc'), '{}');
    await writeFile(join(cfDir, '_worker.ts'), 'export default {}');

    const cmd = generatePreviewCommand(buildDir);
    const configPath = cmd.args[cmd.args.indexOf('--config') + 1];
    expect(configPath).toContain('wrangler.jsonc');
  });

  it('nitro node-server preview points to entry.ts', () => {
    const buildDir = '/project/.timber/build';
    const cmd = generateNitroPreviewCommand(buildDir, 'node-server');
    expect(cmd).not.toBeNull();
    expect(cmd!.args).toContain(join(buildDir, 'nitro', 'entry.ts'));
  });
});
