// Nitro adapter — multi-platform deployment
//
// Covers everything except Cloudflare Workers: Node.js, Bun, Vercel,
// Netlify, AWS Lambda, Deno Deploy, Azure Functions. Nitro handles
// compression, graceful shutdown, static file serving, and platform quirks.
// See design/11-platform.md and design/25-production-deployments.md.

import { writeFile, mkdir, cp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, relative } from 'node:path';
import type { TimberPlatformAdapter, TimberConfig } from './types';
import { IMMUTABLE_CACHE, generateHeadersFile } from '../server/asset-headers.js';

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
  | 'node-server'
  | 'bun';

/** Preset-specific Nitro configuration. */
interface PresetConfig {
  /** Nitro preset name passed to the Nitro build. */
  nitroPreset: string;
  /** Output directory name within the build dir. */
  outputDir: string;
  /** Whether the runtime supports waitUntil. */
  supportsWaitUntil: boolean;
  /** Whether the runtime supports application-level 103 Early Hints. */
  supportsEarlyHints: boolean;
  /** Value for TIMBER_RUNTIME env var. See design/25-production-deployments.md. */
  runtimeName: string;
  /** Additional nitro.config fields for this preset. */
  extraConfig?: Record<string, unknown>;
}

const PRESET_CONFIGS: Record<NitroPreset, PresetConfig> = {
  'vercel': {
    nitroPreset: 'vercel',
    outputDir: '.vercel/output',
    supportsWaitUntil: true,
    supportsEarlyHints: false,
    runtimeName: 'vercel',
    extraConfig: { vercel: { functions: { maxDuration: 30 } } },
  },
  'vercel-edge': {
    nitroPreset: 'vercel-edge',
    outputDir: '.vercel/output',
    supportsWaitUntil: true,
    supportsEarlyHints: false,
    runtimeName: 'vercel-edge',
  },
  'netlify': {
    nitroPreset: 'netlify',
    outputDir: '.netlify/functions-internal',
    supportsWaitUntil: false,
    supportsEarlyHints: false,
    runtimeName: 'netlify',
  },
  'netlify-edge': {
    nitroPreset: 'netlify-edge',
    outputDir: '.netlify/edge-functions',
    supportsWaitUntil: true,
    supportsEarlyHints: false,
    runtimeName: 'netlify-edge',
  },
  'aws-lambda': {
    nitroPreset: 'aws-lambda',
    outputDir: '.output',
    supportsWaitUntil: false,
    supportsEarlyHints: false,
    runtimeName: 'aws-lambda',
  },
  'deno-deploy': {
    nitroPreset: 'deno-deploy',
    outputDir: '.output',
    supportsWaitUntil: true,
    supportsEarlyHints: false,
    runtimeName: 'deno-deploy',
  },
  'azure-functions': {
    nitroPreset: 'azure-functions',
    outputDir: '.output',
    supportsWaitUntil: false,
    supportsEarlyHints: false,
    runtimeName: 'azure-functions',
  },
  'node-server': {
    nitroPreset: 'node-server',
    outputDir: '.output',
    supportsWaitUntil: true,
    supportsEarlyHints: true,
    runtimeName: 'node-server',
  },
  'bun': {
    nitroPreset: 'bun',
    outputDir: '.output',
    supportsWaitUntil: true,
    supportsEarlyHints: true,
    runtimeName: 'bun',
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

      // Copy client assets to public directory.
      // When client JavaScript is disabled, skip .js files — only CSS,
      // fonts, images, and other static assets are needed.
      const clientDir = join(buildDir, 'client');
      const publicDir = join(outDir, 'public');
      await mkdir(publicDir, { recursive: true });
      await cp(clientDir, publicDir, {
        recursive: true,
        filter: config.clientJavascriptDisabled ? (src: string) => !src.endsWith('.js') : undefined,
      }).catch(() => {
        // Client dir may not exist when client JavaScript is disabled
      });

      // Write _headers file for platforms that support it (Netlify, etc.).
      // See design/25-production-deployments.md §"CDN / Edge Cache"
      await writeFile(join(publicDir, '_headers'), generateHeadersFile());

      // Write the build manifest init module (if manifest data was produced).
      if (config.manifestInit) {
        await writeFile(join(outDir, '_timber-manifest-init.js'), config.manifestInit);
      }

      // Generate the Nitro entry point
      const hasManifestInit = !!config.manifestInit;
      const entry = generateNitroEntry(buildDir, outDir, preset, hasManifestInit);
      await writeFile(join(outDir, 'entry.ts'), entry);

      // Generate the Nitro config with static asset cache rules
      const nitroConfig = generateNitroConfig(preset, options.nitroConfig);
      await writeFile(join(outDir, 'nitro.config.ts'), nitroConfig);
    },

    // Only presets that produce a locally-runnable server get preview().
    // Serverless presets (vercel, netlify, aws-lambda, etc.) have no
    // local runtime — Vite's built-in preview is the fallback.
    preview: LOCALLY_PREVIEWABLE.has(preset)
      ? async (_config: TimberConfig, buildDir: string) => {
          const cmd = generateNitroPreviewCommand(buildDir, preset);
          if (!cmd) return;
          await spawnNitroPreview(cmd.command, cmd.args, cmd.cwd);
        }
      : undefined,

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
export function generateNitroEntry(
  buildDir: string,
  outDir: string,
  preset: NitroPreset,
  hasManifestInit = false
): string {
  const serverEntryRelative = relative(outDir, join(buildDir, 'server', 'entry.js'));
  const runtimeName = PRESET_CONFIGS[preset].runtimeName;
  const earlyHints = PRESET_CONFIGS[preset].supportsEarlyHints;

  // Build manifest init must be imported before the handler so that
  // globalThis.__TIMBER_BUILD_MANIFEST__ is set when the virtual module evaluates.
  const manifestImport = hasManifestInit ? "import './_timber-manifest-init.js'\n" : '';

  // On node-server and bun, wrap the handler with ALS so the pipeline
  // can send 103 Early Hints via res.writeEarlyHints(). Other presets
  // either don't support 103 or handle it at the CDN level.
  const earlyHintsImport = earlyHints
    ? `import { runWithEarlyHintsSender } from '${serverEntryRelative}'\n`
    : '';

  const handlerCall = earlyHints
    ? `  const nodeRes = event.node?.res
  const earlyHintsSender = (typeof nodeRes?.writeEarlyHints === 'function')
    ? (links) => { try { nodeRes.writeEarlyHints({ link: links }) } catch {} }
    : undefined

  const webResponse = earlyHintsSender
    ? await runWithEarlyHintsSender(earlyHintsSender, () => handler(webRequest))
    : await handler(webRequest)`
    : `  const webResponse = await handler(webRequest)`;

  return `// Generated by @timber/app/adapters/nitro
// Do not edit — this file is regenerated on each build.

${manifestImport}${earlyHintsImport}import { defineEventHandler, toWebRequest, sendWebResponse } from 'h3'
import { handler } from '${serverEntryRelative}'

// Set TIMBER_RUNTIME for instrumentation.ts conditional SDK initialization.
// See design/25-production-deployments.md §"TIMBER_RUNTIME".
process.env.TIMBER_RUNTIME = '${runtimeName}'

export default defineEventHandler(async (event) => {
  const webRequest = toWebRequest(event)
${handlerCall}
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
    // Static asset cache headers — hashed assets are immutable, others get 1h.
    // See design/25-production-deployments.md §"CDN / Edge Cache"
    routeRules: {
      '/assets/**': { headers: { 'Cache-Control': IMMUTABLE_CACHE } },
    },
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

// ─── Preview ─────────────────────────────────────────────────────────────────

/** Presets that produce a locally-runnable server entry. */
const LOCALLY_PREVIEWABLE = new Set<NitroPreset>(['node-server', 'bun']);

/** Command descriptor for Nitro preview — testable without spawning. */
export interface NitroPreviewCommand {
  command: string;
  args: string[];
  cwd: string;
}

/** @internal Exported for testing. */
export function generateNitroPreviewCommand(
  buildDir: string,
  preset: NitroPreset
): NitroPreviewCommand | null {
  if (!LOCALLY_PREVIEWABLE.has(preset)) return null;

  const nitroDir = join(buildDir, 'nitro');
  const entryPath = join(nitroDir, 'entry.ts');

  const command = preset === 'bun' ? 'bun' : 'node';
  return {
    command,
    args: [entryPath],
    cwd: nitroDir,
  };
}

/** Spawn a Nitro preview process and pipe stdio. */
function spawnNitroPreview(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = execFile(command, args, { cwd }, (err) => {
      if (err) reject(err);
      else resolve();
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the preset configuration for a given preset name.
 * @internal Exported for testing.
 */
export function getPresetConfig(preset: NitroPreset): PresetConfig {
  return PRESET_CONFIGS[preset];
}
