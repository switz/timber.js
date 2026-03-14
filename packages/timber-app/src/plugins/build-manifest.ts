/**
 * timber-build-manifest — Vite sub-plugin for build asset manifest generation.
 *
 * Provides `virtual:timber-build-manifest` which exports a BuildManifest
 * mapping route segment file paths to their CSS, JS, and modulepreload
 * output chunks.
 *
 * - Dev mode: exports an empty manifest (Vite HMR handles CSS/JS).
 * - Build mode: virtual module reads from globalThis.__TIMBER_BUILD_MANIFEST__
 *   at runtime. The actual manifest data is injected by the adapter via a
 *   _timber-manifest-init.js module that runs before the RSC handler.
 *
 * The generateBundle hook (client env only) extracts CSS/JS/modulepreload
 * data from the Rollup bundle and populates ctx.buildManifest.
 *
 * Design docs: 18-build-system.md §"Build Manifest", 02-rendering-pipeline.md §"Early Hints"
 */

import type { Plugin, ResolvedConfig } from 'vite';
import type { PluginContext } from '@/index.js';
import type { BuildManifest } from '@/server/build-manifest.js';

// Rollup types used by generateBundle hook — imported from vite which re-exports them.
// We define minimal interfaces here to avoid a direct 'rollup' dependency.
interface OutputChunk {
  type: 'chunk';
  fileName: string;
  facadeModuleId: string | null;
  imports: string[];
  name: string;
  code: string;
  viteMetadata?: { importedCss?: Set<string> };
}

interface OutputAsset {
  type: 'asset';
  fileName: string;
}

type OutputBundle = Record<string, OutputChunk | OutputAsset>;

const VIRTUAL_MODULE_ID = 'virtual:timber-build-manifest';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_MODULE_ID}`;

/**
 * Vite's manifest.json entry shape (subset we need).
 * See https://vite.dev/guide/backend-integration.html
 */
interface ViteManifestEntry {
  file: string;
  css?: string[];
  imports?: string[];
}

/**
 * Parse Vite's .vite/manifest.json into a BuildManifest.
 *
 * Walks each entry and collects:
 * - `css`: CSS output URLs per input file (transitive CSS included by Vite)
 * - `js`: Hashed JS chunk URL per input file
 * - `modulepreload`: Transitive JS dependency URLs per input file
 *
 * Keys are input file paths (relative to project root).
 */
export function parseViteManifest(
  viteManifest: Record<string, ViteManifestEntry>,
  base: string
): BuildManifest {
  const css: Record<string, string[]> = {};
  const js: Record<string, string> = {};
  const modulepreload: Record<string, string[]> = {};

  for (const [inputPath, entry] of Object.entries(viteManifest)) {
    // JS chunk mapping
    js[inputPath] = base + entry.file;

    // CSS mapping
    if (entry.css && entry.css.length > 0) {
      css[inputPath] = entry.css.map((cssPath) => base + cssPath);
    }

    // Collect transitive JS dependencies for modulepreload
    modulepreload[inputPath] = collectTransitiveDeps(inputPath, viteManifest, base);
  }

  return { css, js, modulepreload, fonts: {} };
}

/**
 * Recursively collect transitive JS dependency URLs for an entry.
 *
 * Walks the `imports` graph in Vite's manifest, resolving each import
 * key to its output `file` URL. Deduplicates to avoid cycles and
 * redundant preloads.
 */
function collectTransitiveDeps(
  entryKey: string,
  manifest: Record<string, ViteManifestEntry>,
  base: string
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  function walk(key: string) {
    const entry = manifest[key];
    if (!entry?.imports) return;

    for (const importKey of entry.imports) {
      if (seen.has(importKey)) continue;
      seen.add(importKey);

      const dep = manifest[importKey];
      if (dep) {
        result.push(base + dep.file);
        walk(importKey);
      }
    }
  }

  walk(entryKey);
  return result;
}

/**
 * Build a BuildManifest from a Rollup output bundle.
 *
 * Unlike parseViteManifest (which reads Vite's manifest.json), this
 * works directly with the Rollup bundle output. This is necessary because
 * the RSC plugin doesn't produce a standard Vite manifest.json.
 *
 * Walks each chunk in the bundle and collects:
 * - `css`: CSS files imported by each chunk (via viteMetadata.importedCss)
 * - `js`: The output filename for each chunk with a facadeModuleId
 * - `modulepreload`: Transitive JS imports for each entry chunk
 *
 * Keys are input file paths relative to root.
 */
export function buildManifestFromBundle(
  bundle: OutputBundle,
  base: string,
  root: string
): BuildManifest {
  const css: Record<string, string[]> = {};
  const js: Record<string, string> = {};
  const modulepreload: Record<string, string[]> = {};

  // Build a map of chunk fileName → chunk for transitive dep resolution
  const chunksByFileName = new Map<string, OutputChunk>();
  for (const item of Object.values(bundle) as (OutputChunk | OutputAsset)[]) {
    if (item.type === 'chunk') {
      chunksByFileName.set(item.fileName, item);
    }
  }

  for (const item of Object.values(bundle) as (OutputChunk | OutputAsset)[]) {
    if (item.type !== 'chunk') continue;

    const chunk = item;
    if (!chunk.facadeModuleId) continue;

    // Convert absolute facadeModuleId to root-relative path
    let inputPath = chunk.facadeModuleId;
    if (inputPath.startsWith(root)) {
      inputPath = inputPath.slice(root.length + 1);
    }

    // JS chunk mapping
    js[inputPath] = base + chunk.fileName;

    // CSS mapping via viteMetadata
    const viteMetadata = chunk.viteMetadata;
    if (viteMetadata?.importedCss && viteMetadata.importedCss.size > 0) {
      css[inputPath] = Array.from(viteMetadata.importedCss).map((cssFile) => base + cssFile);
    }

    // Collect transitive JS dependencies for modulepreload
    const deps = collectTransitiveBundleDeps(chunk, chunksByFileName, base);
    if (deps.length > 0) {
      modulepreload[inputPath] = deps;
    }
  }

  // Collect ALL CSS assets from the bundle under the `_global` key.
  // Route files (app/layout.tsx, app/page.tsx) are server components —
  // they don't appear in the client bundle, so per-route CSS keying
  // via facadeModuleId doesn't work. The RSC plugin handles per-route
  // CSS injection via data-rsc-css-href. For Link headers (103 Early
  // Hints), we emit all CSS files — they're just prefetch hints.
  const allCss: string[] = [];
  for (const item of Object.values(bundle) as (OutputChunk | OutputAsset)[]) {
    if (item.type === 'asset' && item.fileName.endsWith('.css')) {
      allCss.push(base + item.fileName);
    }
  }
  if (allCss.length > 0) {
    css['_global'] = allCss;
  }

  return { css, js, modulepreload, fonts: {} };
}

/**
 * Recursively collect transitive JS dependency URLs from a bundle chunk.
 */
function collectTransitiveBundleDeps(
  chunk: OutputChunk,
  chunksByFileName: Map<string, OutputChunk>,
  base: string
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  function walk(imports: string[]) {
    for (const importFileName of imports) {
      if (seen.has(importFileName)) continue;
      seen.add(importFileName);

      result.push(base + importFileName);
      const dep = chunksByFileName.get(importFileName);
      if (dep) {
        walk(dep.imports);
      }
    }
  }

  walk(chunk.imports);
  return result;
}

/**
 * Create the timber-build-manifest Vite plugin.
 *
 * Hooks: configResolved, resolveId, load, generateBundle (client env only)
 */
export function timberBuildManifest(ctx: PluginContext): Plugin {
  let resolvedBase = '/';
  let isDev = false;

  return {
    name: 'timber-build-manifest',

    configResolved(config: ResolvedConfig) {
      resolvedBase = config.base;
      isDev = config.command === 'serve';
    },

    resolveId(id: string) {
      const cleanId = id.startsWith('\0') ? id.slice(1) : id;

      if (cleanId === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_ID;
      }

      if (cleanId.endsWith(`/${VIRTUAL_MODULE_ID}`)) {
        return RESOLVED_VIRTUAL_ID;
      }

      return null;
    },

    load(id: string) {
      if (id !== RESOLVED_VIRTUAL_ID) return null;

      // In dev mode, return empty manifest — Vite HMR handles CSS.
      if (isDev) {
        return [
          '// Auto-generated build manifest — do not edit.',
          '// Dev mode: empty manifest (Vite HMR handles CSS/JS).',
          '',
          'const manifest = { css: {}, js: {}, modulepreload: {}, fonts: {} };',
          '',
          'export default manifest;',
        ].join('\n');
      }

      // In production, read from globalThis at runtime.
      // The adapter writes a _timber-manifest-init.js that sets this global
      // before the RSC handler imports this module. ESM evaluation order
      // guarantees the global is set by the time this code runs.
      return [
        '// Auto-generated build manifest — do not edit.',
        '// Production: reads manifest from globalThis (set by _timber-manifest-init.js).',
        '',
        'const manifest = globalThis.__TIMBER_BUILD_MANIFEST__ ?? { css: {}, js: {}, modulepreload: {}, fonts: {} };',
        '',
        'export default manifest;',
      ].join('\n');
    },

    // Extract manifest data from the client bundle only.
    // The RSC plugin runs builds in order: RSC → client → SSR.
    // We only want client env data (CSS assets, client JS chunks).
    generateBundle(_options, bundle) {
      if (isDev) return;

      const envName = (this as { environment?: { name: string } }).environment?.name;

      if (envName === 'client') {
        ctx.buildManifest = buildManifestFromBundle(bundle, resolvedBase, ctx.root);

        // When client JavaScript is disabled, strip JS chunks from the bundle
        // so Rollup never writes them to disk. CSS assets are preserved —
        // they're still needed for server-rendered HTML.
        //
        // This is an optimization: adapter-build.ts still strips JS from the
        // build manifest and RSC assets manifest as a defense-in-depth fallback.
        if (ctx.clientJavascript.disabled) {
          // Clear JS and modulepreload from the manifest (they'd be stripped
          // by adapter-build.ts anyway, but doing it here avoids the round-trip).
          ctx.buildManifest.js = {};
          ctx.buildManifest.modulepreload = {};

          // Remove JS chunks from the Rollup bundle — prevents disk writes.
          for (const [fileName, item] of Object.entries(bundle)) {
            if (item.type === 'chunk') {
              delete bundle[fileName];
            }
          }
        }
      }
    },
  };
}
