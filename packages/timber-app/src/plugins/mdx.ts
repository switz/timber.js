/**
 * timber-mdx — Vite sub-plugin for MDX page rendering.
 *
 * Wires @mdx-js/rollup into the Vite pipeline when MDX is activated.
 * MDX is activated when pageExtensions includes 'mdx' or 'md', or
 * when a content/ directory exists at the project root.
 *
 * Design doc: 20-content-collections.md §"The timber-mdx Plugin"
 */

import type { Plugin } from 'vite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginContext } from '../index.js';

const MDX_EXTENSIONS = ['mdx', 'md'];

/**
 * Check if mdx-components.tsx (or .ts, .jsx, .js) exists at the project root.
 * Returns the absolute path if found, otherwise undefined.
 */
function findMdxComponents(root: string): string | undefined {
  const candidates = [
    'mdx-components.tsx',
    'mdx-components.ts',
    'mdx-components.jsx',
    'mdx-components.js',
  ];
  for (const name of candidates) {
    const p = join(root, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Determine if MDX should be activated based on config and project structure.
 */
function shouldActivate(ctx: PluginContext): boolean {
  const exts = ctx.config.pageExtensions;
  if (exts && exts.some((ext) => MDX_EXTENSIONS.includes(ext))) {
    return true;
  }

  if (existsSync(join(ctx.root, 'content'))) {
    return true;
  }

  return false;
}

/**
 * Try to dynamically import a module by name. Returns the default export
 * or the module itself, or undefined if the module is not installed.
 */
async function tryImport(name: string): Promise<unknown | undefined> {
  try {
    const mod = await import(name);
    return mod.default ?? mod;
  } catch {
    return undefined;
  }
}

/**
 * Create the timber-mdx Vite plugin.
 *
 * Uses the transform and resolveId hooks to delegate MDX compilation
 * to @mdx-js/rollup. The inner plugin is loaded lazily on first activation.
 *
 * Hooks: buildStart (loads @mdx-js/rollup), resolveId, load, transform
 */
export function timberMdx(ctx: PluginContext): Plugin {
  let innerPlugin: Plugin | null = null;

  async function activate(): Promise<void> {
    if (innerPlugin !== null || !shouldActivate(ctx)) return;

    const createMdxPlugin = (await tryImport('@mdx-js/rollup')) as
      | ((options?: Record<string, unknown>) => Plugin)
      | undefined;

    if (!createMdxPlugin) {
      throw new Error(
        [
          '[timber] MDX is enabled but @mdx-js/rollup is not installed.',
          '',
          'Install it:',
          '  pnpm add -D @mdx-js/rollup remark-frontmatter remark-mdx-frontmatter',
          '',
          'MDX is activated because pageExtensions includes "mdx"/"md" or a content/ directory exists.',
        ].join('\n')
      );
    }

    const mdxConfig = ctx.config.mdx ?? {};

    // Auto-register frontmatter plugins
    const remarkPlugins: unknown[] = [];
    const remarkFrontmatter = await tryImport('remark-frontmatter');
    const remarkMdxFrontmatter = await tryImport('remark-mdx-frontmatter');
    if (remarkFrontmatter) remarkPlugins.push(remarkFrontmatter);
    if (remarkMdxFrontmatter) remarkPlugins.push(remarkMdxFrontmatter);

    if (mdxConfig.remarkPlugins) {
      remarkPlugins.push(...mdxConfig.remarkPlugins);
    }

    const mdxOptions: Record<string, unknown> = {
      remarkPlugins,
      rehypePlugins: mdxConfig.rehypePlugins ?? [],
      recmaPlugins: mdxConfig.recmaPlugins ?? [],
      remarkRehypeOptions: mdxConfig.remarkRehypeOptions,
    };

    const mdxComponentsPath = findMdxComponents(ctx.root);
    if (mdxComponentsPath) {
      mdxOptions.providerImportSource = mdxComponentsPath;
    }

    innerPlugin = createMdxPlugin(mdxOptions);
  }

  return {
    name: 'timber-mdx',
    // Must run before @vitejs/plugin-rsc (rsc:use-client) which tries to parse
    // all files as JS. MDX files must be compiled to JS first.
    enforce: 'pre',

    async buildStart(options) {
      ctx.timer.start('mdx-activate');
      await activate();
      ctx.timer.end('mdx-activate');
      if (!innerPlugin) return;
      if (typeof innerPlugin.buildStart === 'function') {
        await (innerPlugin.buildStart as (options: unknown) => void | Promise<void>).call(
          this,
          options
        );
      }
    },

    async resolveId(source, importer, options) {
      if (!innerPlugin) return null;
      if (typeof innerPlugin.resolveId === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (innerPlugin.resolveId as any).call(this, source, importer, options);
      }
      return null;
    },

    async load(id) {
      if (!innerPlugin) return null;
      if (typeof innerPlugin.load === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (innerPlugin.load as any).call(this, id);
      }
      return null;
    },

    async transform(code, id) {
      if (!innerPlugin) return null;
      if (typeof innerPlugin.transform === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (innerPlugin.transform as any).call(this, code, id);
      }
      return null;
    },
  };
}
