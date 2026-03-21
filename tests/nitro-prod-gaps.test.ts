/**
 * Tests for Nitro production gaps: waitUntil runtime wiring + slowRequestMs config.
 *
 * Validates:
 * - Generated Nitro entries bridge h3's event.waitUntil() for supported presets
 * - waitUntil ALS bridge works correctly
 * - slowRequestMs flows from config through virtual module to pipeline
 * - Generated entries don't import runWithWaitUntil for unsupported presets
 *
 * Design docs: design/11-platform.md, design/17-logging.md
 * Task: LOCAL-331
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateNitroEntry } from '../packages/timber-app/src/adapters/nitro';
import type { NitroPreset } from '../packages/timber-app/src/adapters/nitro';
import { runWithWaitUntil, getWaitUntil } from '../packages/timber-app/src/server/waituntil-bridge';
import { waitUntil, _resetWaitUntilWarning } from '../packages/timber-app/src/server/primitives';


// ─── waitUntil ALS bridge ────────────────────────────────────────────────

describe('waitUntil ALS bridge', () => {
  it('getWaitUntil returns undefined outside request context', () => {
    expect(getWaitUntil()).toBeUndefined();
  });

  it('runWithWaitUntil installs the function for the request duration', () => {
    const fn = (_p: Promise<unknown>) => {};

    runWithWaitUntil(fn, () => {
      expect(getWaitUntil()).toBe(fn);
    });

    // Gone after the scope exits
    expect(getWaitUntil()).toBeUndefined();
  });

  it('waitUntil() primitive uses ALS bridge when installed', () => {
    _resetWaitUntilWarning();
    const collected: Promise<unknown>[] = [];
    const fn = (p: Promise<unknown>) => { collected.push(p); };

    const testPromise = Promise.resolve('test');
    runWithWaitUntil(fn, () => {
      waitUntil(testPromise);
    });

    expect(collected).toHaveLength(1);
    expect(collected[0]).toBe(testPromise);
  });

  it('waitUntil() falls back to adapter when ALS is not set', () => {
    _resetWaitUntilWarning();
    const collected: Promise<unknown>[] = [];
    const adapter = { waitUntil: (p: Promise<unknown>) => { collected.push(p); } };

    const testPromise = Promise.resolve('test');
    waitUntil(testPromise, adapter);

    expect(collected).toHaveLength(1);
    expect(collected[0]).toBe(testPromise);
  });

  it('waitUntil() warns when neither ALS nor adapter is available', () => {
    _resetWaitUntilWarning();
    const warnSpy = globalThis.console.warn;
    const warnings: string[] = [];
    globalThis.console.warn = (msg: string) => { warnings.push(msg); };

    waitUntil(Promise.resolve());

    globalThis.console.warn = warnSpy;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('waitUntil() is not supported');
  });

  it('concurrent requests maintain isolated waitUntil contexts', async () => {
    const collected1: string[] = [];
    const collected2: string[] = [];

    await Promise.all([
      new Promise<void>((resolve) => {
        runWithWaitUntil(
          () => { collected1.push('req1'); },
          async () => {
            await new Promise((r) => setTimeout(r, 10));
            getWaitUntil()!(Promise.resolve());
            resolve();
          }
        );
      }),
      new Promise<void>((resolve) => {
        runWithWaitUntil(
          () => { collected2.push('req2'); },
          async () => {
            await new Promise((r) => setTimeout(r, 5));
            getWaitUntil()!(Promise.resolve());
            resolve();
          }
        );
      }),
    ]);

    expect(collected1).toEqual(['req1']);
    expect(collected2).toEqual(['req2']);
  });
});

// ─── Generated Nitro entry: waitUntil wiring ─────────────────────────────

describe('generated Nitro entry waitUntil wiring', () => {
  const waitUntilPresets: NitroPreset[] = [
    'node-server', 'bun', 'vercel', 'vercel-edge',
    'netlify-edge', 'deno-deploy',
  ];
  const noWaitUntilPresets: NitroPreset[] = [
    'netlify', 'aws-lambda', 'azure-functions',
  ];

  for (const preset of waitUntilPresets) {
    it(`${preset} imports runWithWaitUntil`, () => {
      const entry = generateNitroEntry('/build', '/build/out', preset);
      expect(entry).toContain('runWithWaitUntil');
    });

    it(`${preset} bridges event.waitUntil`, () => {
      const entry = generateNitroEntry('/build', '/build/out', preset);
      expect(entry).toContain('event.waitUntil');
    });
  }

  for (const preset of noWaitUntilPresets) {
    it(`${preset} does NOT import runWithWaitUntil`, () => {
      const entry = generateNitroEntry('/build', '/build/out', preset);
      expect(entry).not.toContain('runWithWaitUntil');
    });
  }
});

// ─── slowRequestMs config wiring ─────────────────────────────────────────

describe('slowRequestMs config wiring', () => {
  it('TimberUserConfig includes slowRequestMs', () => {
    const configPath = resolve(
      __dirname,
      '../packages/timber-app/src/index.ts'
    );
    const source = readFileSync(configPath, 'utf-8');
    expect(source).toContain('slowRequestMs?: number');
  });

  it('virtual config serializes slowRequestMs', () => {
    const entriesPath = resolve(
      __dirname,
      '../packages/timber-app/src/plugins/entries.ts'
    );
    const source = readFileSync(entriesPath, 'utf-8');
    expect(source).toContain('slowRequestMs: ctx.config.slowRequestMs ?? 3000');
  });

  it('RSC entry passes slowRequestMs to pipeline config', () => {
    const entryPath = resolve(
      __dirname,
      '../packages/timber-app/src/server/rsc-entry/index.ts'
    );
    const source = readFileSync(entryPath, 'utf-8');

    // slowRequestMs should appear in the pipelineConfig object
    expect(source).toContain('slowRequestMs:');
    // And it should read from runtimeConfig
    expect(source).toContain('.slowRequestMs');
  });

  it('pipeline supports slowRequestMs: 0 to disable', () => {
    // The pipeline uses `slowRequestMs > 0` check — 0 disables it.
    const pipelinePath = resolve(
      __dirname,
      '../packages/timber-app/src/server/pipeline.ts'
    );
    const source = readFileSync(pipelinePath, 'utf-8');
    expect(source).toContain('slowRequestMs > 0');
  });
});

// ─── RSC entry exports runWithWaitUntil ──────────────────────────────────

describe('RSC entry exports', () => {
  it('rsc-entry/index.ts re-exports runWithWaitUntil', () => {
    const entryPath = resolve(
      __dirname,
      '../packages/timber-app/src/server/rsc-entry/index.ts'
    );
    const source = readFileSync(entryPath, 'utf-8');
    expect(source).toContain("export { runWithWaitUntil } from '#/server/waituntil-bridge.js'");
  });
});
