import type { Plugin } from 'vite';
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

export function timber(config?: TimberUserConfig): Plugin[] {
  const ctx = createPluginContext(config);
  return [
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
