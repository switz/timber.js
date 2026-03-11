/**
 * timber-content — Vite sub-plugin for content collections.
 *
 * Wraps @content-collections/vite to provide content collection support.
 * Activates only when a content-collections.ts config file exists at the
 * project root.
 *
 * Design doc: 20-content-collections.md §"Content Collections"
 */

import type { Plugin } from 'vite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginContext } from '../index.js';

const CONFIG_FILE_NAMES = [
  'content-collections.ts',
  'content-collections.js',
  'content-collections.mts',
  'content-collections.mjs',
];

/**
 * Find the content-collections config file at the project root.
 * Returns the filename (not full path) if found, otherwise undefined.
 */
function findConfigFile(root: string): string | undefined {
  for (const name of CONFIG_FILE_NAMES) {
    if (existsSync(join(root, name))) return name;
  }
  return undefined;
}

/**
 * Create the timber-content Vite plugin.
 *
 * Delegates all content scanning, validation, code generation, and file watching
 * to @content-collections/vite. This plugin only handles detection and activation.
 */
export function timberContent(ctx: PluginContext): Plugin {
  let innerPlugin: Plugin | null = null;

  async function activate(root: string): Promise<void> {
    if (innerPlugin !== null) return;

    const configFile = findConfigFile(root);
    if (!configFile) return;

    let createPlugin: ((options?: { configPath?: string }) => Plugin) | undefined;
    try {
      const mod = await import('@content-collections/vite');
      createPlugin = (mod.default ?? mod) as typeof createPlugin;
    } catch {
      throw new Error(
        [
          '[timber] Content collections are enabled but @content-collections/vite is not installed.',
          '',
          'Install content-collections:',
          '  pnpm add -D @content-collections/core @content-collections/vite',
          '',
          'For MDX content, also install:',
          '  pnpm add -D @content-collections/mdx',
          '',
          'Content collections are activated because a content-collections.ts file exists.',
        ].join('\n')
      );
    }

    if (createPlugin) {
      innerPlugin = createPlugin({ configPath: configFile });
    }
  }

  return {
    name: 'timber-content',

    async config(config, env) {
      const root = config.root ?? ctx.root;
      await activate(root);
      if (!innerPlugin) return;
      if (typeof innerPlugin.config === 'function') {
        return innerPlugin.config.call(this, config, env);
      }
    },

    async configResolved(config) {
      if (!innerPlugin) return;
      if (typeof innerPlugin.configResolved === 'function') {
        await (innerPlugin.configResolved as (...args: unknown[]) => unknown).call(this, config);
      }
    },

    async buildStart(options) {
      if (!innerPlugin) return;
      if (typeof innerPlugin.buildStart === 'function') {
        await (innerPlugin.buildStart as (...args: unknown[]) => unknown).call(this, options);
      }
    },

    async resolveId(source: string, importer: string | undefined, options: unknown) {
      if (!innerPlugin) return null;
      if (typeof innerPlugin.resolveId === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (innerPlugin.resolveId as any).call(this, source, importer, options);
      }
      return null;
    },

    async load(id: string) {
      if (!innerPlugin) return null;
      if (typeof innerPlugin.load === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (innerPlugin.load as any).call(this, id);
      }
      return null;
    },

    async transform(code: string, id: string) {
      if (!innerPlugin) return null;
      if (typeof innerPlugin.transform === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (innerPlugin.transform as any).call(this, code, id);
      }
      return null;
    },

    async configureServer(server) {
      if (!innerPlugin) return;
      if (typeof innerPlugin.configureServer === 'function') {
        await (innerPlugin.configureServer as (...args: unknown[]) => unknown).call(this, server);
      }
    },
  };
}
