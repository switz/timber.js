import type { Plugin, PluginOption } from 'vite';
import { join } from 'node:path';
import { cacheTransformPlugin } from './plugins/cache-transform';
import { timberContent } from './plugins/content';
import { timberDevServer } from './plugins/dev-server';
import { timberEntries } from './plugins/entries';
import { timberMdx } from './plugins/mdx';
import { timberRouting } from './plugins/routing';
import { timberShims } from './plugins/shims';
import { timberStaticBuild } from './plugins/static-build';
import { timberDynamicTransform } from './plugins/dynamic-transform';
import type { RouteTree } from './routing/types';

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
  };
}

function timberCache(_ctx: PluginContext): Plugin {
  return cacheTransformPlugin();
}

function timberFonts(_ctx: PluginContext): Plugin {
  return {
    name: 'timber-fonts',
  };
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
  const rscPluginsPromise = import('@vitejs/plugin-rsc').then(({ default: vitePluginRsc }) =>
    vitePluginRsc({
      serverHandler: false,
      customBuildApp: true,
      // Tell the RSC plugin our browser entry so loadBootstrapScriptContent('index')
      // can resolve it. This sets environments.client.build.rollupOptions.input.index.
      entries: { client: 'virtual:timber-browser-entry' },
    })
  );

  return [
    rootSync,
    rscPluginsPromise,
    timberShims(ctx),
    timberRouting(ctx),
    timberEntries(ctx),
    timberCache(ctx),
    timberStaticBuild(ctx),
    timberDynamicTransform(ctx),
    timberFonts(ctx),
    timberMdx(ctx),
    timberContent(ctx),
    timberDevServer(ctx), // Must be last — configureServer post-hook runs after all watchers
  ];
}

export default timber;

// React components — re-exported for user-facing imports.
// Design doc: import { DeferredSuspense } from '@timber/app'
export { DeferredSuspense } from './server/deferred-suspense';
export type { DeferredSuspenseProps } from './server/deferred-suspense';
