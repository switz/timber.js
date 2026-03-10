// Nitro adapter — multi-platform deployment
//
// Covers Vercel, Netlify, AWS Amplify, Deno Deploy, Azure, and any
// other platform Nitro supports. Community platforms that don't have
// a first-party adapter should use this.
// See design/11-platform.md §"Nitro".

import { writeFile, mkdir, cp } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { TimberPlatformAdapter, TimberConfig } from './types';

// ─── Presets ─────────────────────────────────────────────────────────────────

/**
 * Supported Nitro deployment presets.
 *
 * Each preset maps to a Nitro deployment target. The adapter generates
 * the appropriate configuration and entry point for the selected platform.
 */
export type NitroPreset =
  | 'vercel'
  | 'vercel-edge'
  | 'netlify'
  | 'netlify-edge'
  | 'aws-lambda'
  | 'deno-deploy'
  | 'azure-functions'
  | 'node-server';

/** Preset-specific Nitro configuration. */
interface PresetConfig {
  /** Nitro preset name passed to the Nitro build. */
  nitroPreset: string;
  /** Output directory name within the build dir. */
  outputDir: string;
  /** Whether the runtime supports waitUntil. */
  supportsWaitUntil: boolean;
  /** Additional nitro.config fields for this preset. */
  extraConfig?: Record<string, unknown>;
}

const PRESET_CONFIGS: Record<NitroPreset, PresetConfig> = {
  'vercel': {
    nitroPreset: 'vercel',
    outputDir: '.vercel/output',
    supportsWaitUntil: true,
    extraConfig: { vercel: { functions: { maxDuration: 30 } } },
  },
  'vercel-edge': {
    nitroPreset: 'vercel-edge',
    outputDir: '.vercel/output',
    supportsWaitUntil: true,
  },
  'netlify': {
    nitroPreset: 'netlify',
    outputDir: '.netlify/functions-internal',
    supportsWaitUntil: false,
  },
  'netlify-edge': {
    nitroPreset: 'netlify-edge',
    outputDir: '.netlify/edge-functions',
    supportsWaitUntil: true,
  },
  'aws-lambda': {
    nitroPreset: 'aws-lambda',
    outputDir: '.output',
    supportsWaitUntil: false,
  },
  'deno-deploy': {
    nitroPreset: 'deno-deploy',
    outputDir: '.output',
    supportsWaitUntil: true,
  },
  'azure-functions': {
    nitroPreset: 'azure-functions',
    outputDir: '.output',
    supportsWaitUntil: false,
  },
  'node-server': {
    nitroPreset: 'node-server',
    outputDir: '.output',
    supportsWaitUntil: true,
  },
};

// ─── Options ─────────────────────────────────────────────────────────────────

/** Options for the Nitro adapter. */
export interface NitroAdapterOptions {
  /**
   * Deployment preset. Determines the target platform.
   * @default 'node-server'
   */
  preset?: NitroPreset;

  /**
   * Additional Nitro configuration to merge into the generated config.
   * Overrides default values for the selected preset.
   */
  nitroConfig?: Record<string, unknown>;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * Create a Nitro-based adapter for multi-platform deployment.
 *
 * Nitro abstracts deployment targets — the same timber.js app can deploy
 * to Vercel, Netlify, AWS, Deno Deploy, or Azure by changing the preset.
 *
 * @example
 * ```ts
 * import { nitro } from '@timber/app/adapters/nitro'
 *
 * export default {
 *   output: 'server',
 *   adapter: nitro({ preset: 'vercel' }),
 * }
 * ```
 */
export function nitro(options: NitroAdapterOptions = {}): TimberPlatformAdapter {
  const preset = options.preset ?? 'node-server';
  const presetConfig = PRESET_CONFIGS[preset];
  const pendingPromises: Promise<unknown>[] = [];

  return {
    name: `nitro-${preset}`,

    async buildOutput(config: TimberConfig, buildDir: string) {
      const outDir = join(buildDir, 'nitro');
      await mkdir(outDir, { recursive: true });

      // Copy client assets to public directory
      const clientDir = join(buildDir, 'client');
      const publicDir = join(outDir, 'public');
      await mkdir(publicDir, { recursive: true });
      await cp(clientDir, publicDir, { recursive: true }).catch(() => {
        // Client dir may not exist in static+noJS mode
      });

      // Generate the Nitro entry point
      const entry = generateNitroEntry(buildDir, outDir);
      await writeFile(join(outDir, 'entry.ts'), entry);

      // Generate the Nitro config
      const nitroConfig = generateNitroConfig(preset, options.nitroConfig);
      await writeFile(join(outDir, 'nitro.config.ts'), nitroConfig);
    },

    waitUntil: presetConfig.supportsWaitUntil
      ? (promise: Promise<unknown>) => {
          const tracked = promise.catch((err) => {
            console.error('[timber] waitUntil promise rejected:', err);
          });
          pendingPromises.push(tracked);
        }
      : undefined,
  };
}

// ─── Entry Generation ────────────────────────────────────────────────────────

/** @internal Exported for testing. */
export function generateNitroEntry(buildDir: string, outDir: string): string {
  const serverEntryRelative = relative(outDir, join(buildDir, 'server', 'entry.js'));

  return `// Generated by @timber/app/adapters/nitro
// Do not edit — this file is regenerated on each build.

import { defineEventHandler, toWebRequest, sendWebResponse } from 'h3'
import { handler } from '${serverEntryRelative}'

export default defineEventHandler(async (event) => {
  const webRequest = toWebRequest(event)
  const webResponse = await handler(webRequest)
  return sendWebResponse(event, webResponse)
})
`;
}

/** @internal Exported for testing. */
export function generateNitroConfig(
  preset: NitroPreset,
  userConfig?: Record<string, unknown>
): string {
  const presetConfig = PRESET_CONFIGS[preset];

  const config: Record<string, unknown> = {
    preset: presetConfig.nitroPreset,
    output: { dir: presetConfig.outputDir },
    ...presetConfig.extraConfig,
    ...userConfig,
  };

  const configJson = JSON.stringify(config, null, 2);

  return `// Generated by @timber/app/adapters/nitro
// Do not edit — this file is regenerated on each build.

import { defineNitroConfig } from 'nitropack/config'

export default defineNitroConfig(${configJson})
`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the preset configuration for a given preset name.
 * @internal Exported for testing.
 */
export function getPresetConfig(preset: NitroPreset): PresetConfig {
  return PRESET_CONFIGS[preset];
}
