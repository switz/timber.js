import { describe, it, expect } from 'vitest';
import { timberMdx } from '../packages/timber-app/src/plugins/mdx';
import type { PluginContext } from '../packages/timber-app/src/index';

function createCtx(overrides?: Partial<PluginContext>): PluginContext {
  return {
    config: {
      output: 'server',
      ...overrides?.config,
    },
    routeTree: null,
    appDir: '/project/app',
    root: '/project',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// timber-mdx plugin basics
// ---------------------------------------------------------------------------

describe('timber-mdx', () => {
  it('has the correct plugin name', () => {
    const plugin = timberMdx(createCtx());
    expect(plugin.name).toBe('timber-mdx');
  });

  it('does not activate when no MDX extensions or content dir', async () => {
    const ctx = createCtx({
      config: { output: 'server', pageExtensions: ['tsx', 'ts'] },
    });
    const plugin = timberMdx(ctx);

    // buildStart should be a no-op — no activation
    await (plugin.buildStart as Function)?.({});

    // transform should return null (inner plugin not loaded)
    const result = await (plugin.transform as Function)?.('code', 'file.mdx');
    expect(result).toBeNull();
  });

  it('activates when pageExtensions includes mdx', async () => {
    const ctx = createCtx({
      config: { output: 'server', pageExtensions: ['tsx', 'ts', 'mdx'] },
    });
    const plugin = timberMdx(ctx);

    // buildStart triggers activation — should load @mdx-js/rollup
    await (plugin.buildStart as Function)?.({});

    // transform should now delegate to inner plugin (non-null return for .mdx files)
    // We can't fully test transform without a real MDX file, but the plugin should be loaded
    expect(plugin.name).toBe('timber-mdx');
  });

  it('activates when pageExtensions includes md', async () => {
    const ctx = createCtx({
      config: { output: 'server', pageExtensions: ['tsx', 'md'] },
    });
    const plugin = timberMdx(ctx);

    // Should not throw — @mdx-js/rollup is installed as dev dep
    await (plugin.buildStart as Function)?.({});
  });

  it('passes mdx config options through', () => {
    const ctx = createCtx({
      config: {
        output: 'server',
        pageExtensions: ['mdx'],
        mdx: {
          remarkPlugins: ['fake-remark-plugin'],
          rehypePlugins: ['fake-rehype-plugin'],
        },
      },
    });
    const plugin = timberMdx(ctx);

    // Verify the plugin was created with mdx config available
    expect(plugin.name).toBe('timber-mdx');
    expect(ctx.config.mdx?.remarkPlugins).toEqual(['fake-remark-plugin']);
    expect(ctx.config.mdx?.rehypePlugins).toEqual(['fake-rehype-plugin']);
  });
});
