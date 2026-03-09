import type { Plugin } from 'vite';

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
}

interface PluginContext {
  config: TimberUserConfig;
}

function createPluginContext(config?: TimberUserConfig): PluginContext {
  return {
    config: {
      output: 'server',
      ...config,
    },
  };
}

function timberShims(_ctx: PluginContext): Plugin {
  return {
    name: 'timber-shims',
  };
}

function timberRouting(_ctx: PluginContext): Plugin {
  return {
    name: 'timber-routing',
  };
}

function timberEntries(_ctx: PluginContext): Plugin {
  return {
    name: 'timber-entries',
  };
}

function timberCache(_ctx: PluginContext): Plugin {
  return {
    name: 'timber-cache',
  };
}

function timberFonts(_ctx: PluginContext): Plugin {
  return {
    name: 'timber-fonts',
  };
}

function timberMdx(_ctx: PluginContext): Plugin {
  return {
    name: 'timber-mdx',
  };
}

export function timber(config?: TimberUserConfig): Plugin[] {
  const ctx = createPluginContext(config);
  return [
    timberShims(ctx),
    timberRouting(ctx),
    timberEntries(ctx),
    timberCache(ctx),
    timberFonts(ctx),
    timberMdx(ctx),
  ];
}

export default timber;

// React components — re-exported for user-facing imports.
// Design doc: import { DeferredSuspense } from '@timber/app'
export { DeferredSuspense } from './server/deferred-suspense';
export type { DeferredSuspenseProps } from './server/deferred-suspense';
