/**
 * timber-adapter-build — Invoke the adapter's buildOutput after vite build.
 *
 * After all environments are built and the RSC plugin has written its
 * asset manifests, calls `adapter.buildOutput()` to transform the output
 * into a deployable artifact (e.g., Cloudflare Workers entry + wrangler.jsonc).
 *
 * Uses a `buildApp` hook with `order: 'post'` so that Vite calls the
 * RSC plugin's buildApp (which orchestrates all environment builds and
 * writes asset manifests) first, then runs this handler after everything
 * is complete.
 *
 * Design docs: design/11-platform.md, design/25-production-deployments.md
 */

import type { Plugin } from 'vite';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { PluginContext } from '#/index.js';
import type { TimberPlatformAdapter, TimberConfig } from '#/adapters/types.js';

export function timberAdapterBuild(ctx: PluginContext): Plugin {
  return {
    name: 'timber-adapter-build',

    // order: 'post' causes Vite to run configBuilder.buildApp() (which
    // includes the RSC plugin's buildApp) before calling this handler.
    // By the time we run, all environments are built and asset manifests
    // are written — safe to copy the output.
    buildApp: {
      order: 'post' as const,
      async handler() {
        if (ctx.dev) return;

        const adapter = ctx.config.adapter as TimberPlatformAdapter | undefined;
        if (!adapter || typeof adapter.buildOutput !== 'function') return;

        const buildDir = join(ctx.root, 'dist');

        // Serialize the build manifest as a JS module that sets the global.
        // The adapter writes this as _timber-manifest-init.mjs and imports it
        // before the RSC handler, so globalThis.__TIMBER_BUILD_MANIFEST__ is
        // available when virtual:timber-build-manifest evaluates.
        let manifestInit: string | undefined;
        if (ctx.buildManifest) {
          // Strip JS/modulepreload from manifest when client JS is disabled —
          // those files aren't served, so hints for them are useless.
          const manifest = ctx.clientJavascript.disabled
            ? { ...ctx.buildManifest, js: {}, modulepreload: {} }
            : ctx.buildManifest;
          const json = JSON.stringify(manifest);
          manifestInit = `globalThis.__TIMBER_BUILD_MANIFEST__ = ${json};\n`;
        }

        // Strip JS from the RSC plugin's assets manifest when client JS
        // is disabled. The RSC plugin writes __vite_rsc_assets_manifest.js
        // with clientReferenceDeps containing JS URLs — used to inject
        // <link rel="modulepreload"> tags. Must happen before the adapter
        // copies files to the output directory.
        if (ctx.clientJavascript.disabled) {
          await stripJsFromRscAssetsManifests(buildDir);
        }

        const adapterConfig: TimberConfig = {
          output: ctx.config.output ?? 'server',
          clientJavascriptDisabled: ctx.clientJavascript.disabled,
          manifestInit,
        };

        await adapter.buildOutput(adapterConfig, buildDir);
      },
    },
  };
}

/**
 * Strip JS references from the RSC plugin's assets manifest files.
 *
 * The RSC plugin writes `__vite_rsc_assets_manifest.js` to rsc/ and ssr/
 * as standalone files (not Rollup chunks), so generateBundle can't
 * intercept them. This rewrites the files on disk after all builds
 * complete but before the adapter copies them to the output directory.
 */
async function stripJsFromRscAssetsManifests(buildDir: string): Promise<void> {
  const manifestName = '__vite_rsc_assets_manifest.js';
  const paths = [join(buildDir, 'rsc', manifestName), join(buildDir, 'ssr', manifestName)];

  for (const path of paths) {
    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch {
      continue;
    }

    const jsonStr = content.replace(/^export default\s*/, '').replace(/;?\s*$/, '');
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(jsonStr);
    } catch {
      continue;
    }

    // Clear JS from clientReferenceDeps — preserves CSS
    const deps = manifest.clientReferenceDeps as
      | Record<string, { js: string[]; css: string[] }>
      | undefined;
    if (deps) {
      for (const entry of Object.values(deps)) {
        entry.js = [];
      }
    }

    manifest.bootstrapScriptContent = '';

    await writeFile(path, `export default ${JSON.stringify(manifest, null, 2)};\n`);
  }
}
