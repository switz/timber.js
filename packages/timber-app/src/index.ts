import type { Plugin, PluginOption } from 'vite';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { cacheTransformPlugin } from './plugins/cache-transform';
import { timberContent } from './plugins/content';
import { timberDevServer } from './plugins/dev-server';
import { timberEntries } from './plugins/entries';
import { timberMdx } from './plugins/mdx';
import { timberRouting } from './plugins/routing';
import { timberShims } from './plugins/shims';
import { timberFonts } from './plugins/fonts';
import { timberStaticBuild } from './plugins/static-build';
import { timberDynamicTransform } from './plugins/dynamic-transform';
import { timberBuildManifest } from './plugins/build-manifest';
import type { RouteTree } from './routing/types';
import type { BuildManifest } from './server/build-manifest';

export interface TimberUserConfig {
  output?: 'server' | 'static';
  static?: { noJS?: boolean };
  adapter?: unknown;
  cacheHandler?: unknown;
  allowedOrigins?: string[];
  csrf?: boolean;
  limits?: {
    actionBodySize?: string;
    uploadBodySize?: string;
    maxFields?: number;
  };
  pageExtensions?: string[];
  /** Dev-mode options. These have no effect in production builds. */
  dev?: {
    /** Threshold in ms to highlight slow phases in dev logging output. Default: 200. */
    slowPhaseMs?: number;
  };
  /** MDX compilation options passed to @mdx-js/rollup. See design/20-content-collections.md. */
  mdx?: {
    remarkPlugins?: unknown[];
    rehypePlugins?: unknown[];
    recmaPlugins?: unknown[];
    remarkRehypeOptions?: Record<string, unknown>;
  };
}

/**
 * Shared context object passed to all sub-plugins via closure.
 *
 * Sub-plugins communicate through this context — not through Vite's
 * plugin API or global state.
 * See design/18-build-system.md §"Shared Plugin Context".
 */
export interface PluginContext {
  config: TimberUserConfig;
  /** The scanned route tree (populated by timber-routing, consumed by timber-entries) */
  routeTree: RouteTree | null;
  /** Absolute path to the app/ directory */
  appDir: string;
  /** Absolute path to the project root */
  root: string;
  /** Whether the dev server is running (set by timber-root-sync in configResolved) */
  dev: boolean;
  /** CSS build manifest (populated by adapter after client build, null in dev) */
  buildManifest: BuildManifest | null;
}

function createPluginContext(config?: TimberUserConfig, root?: string): PluginContext {
  const projectRoot = root ?? process.cwd();
  return {
    config: {
      output: 'server',
      ...config,
    },
    routeTree: null,
    appDir: join(projectRoot, 'app'),
    root: projectRoot,
    dev: false,
    buildManifest: null,
  };
}

function timberCache(_ctx: PluginContext): Plugin {
  return cacheTransformPlugin();
}

export function timber(config?: TimberUserConfig): PluginOption[] {
  const ctx = createPluginContext(config);
  // Sync ctx.root and ctx.appDir with Vite's resolved root, which may
  // differ from process.cwd() when --config points to a subdirectory.
  const rootSync: Plugin = {
    name: 'timber-root-sync',
    configResolved(resolved) {
      ctx.root = resolved.root;
      ctx.appDir = join(resolved.root, 'app');
      ctx.dev = resolved.command === 'serve';
    },
  };
  // @vitejs/plugin-rsc handles:
  // - RSC/SSR/client environment setup
  // - "use client" directive → client reference proxy transformation
  // - "use server" directive → server reference transformation
  // - Client reference tracking and module map generation
  //
  // Loaded via dynamic import() because @vitejs/plugin-rsc is ESM-only.
  // Vite's config loader uses esbuild to transpile to CJS, which breaks
  // static imports of ESM-only packages. The dynamic import() is preserved
  // by esbuild and runs natively in ESM at runtime.
  //
  // serverHandler: false — timber has its own dev server (timber-dev-server)
  // customBuildApp: true — timber controls its own build pipeline
  // entries — tells the RSC plugin about timber's virtual entry modules so
  //   it correctly wires up the browser entry (needed for React Fast Refresh
  //   preamble coordination with @vitejs/plugin-react)
  // customClientEntry: true — timber manages its own browser entry and
  //   preloading; skips RSC plugin's default "index" client entry convention
  const rscPluginsPromise = import('@vitejs/plugin-rsc').then(({ default: vitePluginRsc }) =>
    vitePluginRsc({
      serverHandler: false,
      customBuildApp: true,
      customClientEntry: true,
      entries: {
        rsc: 'virtual:timber-rsc-entry',
        ssr: 'virtual:timber-ssr-entry',
        client: 'virtual:timber-browser-entry',
      },
    })
  );

  return [
    rootSync,
    // @vitejs/plugin-react provides React Fast Refresh (state-preserving HMR)
    // for client components via Babel transform. Placed before @vitejs/plugin-rsc
    // following Vinext's convention — the RSC plugin's virtual browser entry
    // coordinates with plugin-react via __vite_plugin_react_preamble_installed__.
    react(),
    rscPluginsPromise,
    timberShims(ctx),
    timberRouting(ctx),
    timberEntries(ctx),
    timberBuildManifest(ctx),
    timberCache(ctx),
    timberStaticBuild(ctx),
    timberDynamicTransform(ctx),
    timberFonts(ctx),
    timberMdx(ctx),
    timberContent(ctx),
    timberDevServer(ctx), // Must be last — configureServer post-hook runs after all watchers
  ];
}

/**
 * Route map interface — augmented by the generated timber-routes.d.ts.
 *
 * Each key is a route path pattern. Values have:
 *   params: shape of URL params (e.g. { id: string })
 *   searchParams: parsed type from search-params.ts, or {} if none
 *
 * This interface is empty by default and populated via codegen.
 * See design/09-typescript.md §"Typed Routes".
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Routes {}

export default timber;
