import { describe, it, expect } from 'vitest';
import type { Plugin } from 'vite';
import { timber } from '@timber/app';

/**
 * Resolve the PluginOption[] returned by timber() into a flat array of
 * Plugin objects. Awaits any promises and flattens nested arrays.
 */
async function resolvePlugins(options: ReturnType<typeof timber>): Promise<Plugin[]> {
  const resolved = await Promise.all(
    options.map(async (opt) => {
      const value = await opt;
      if (Array.isArray(value)) {
        // Nested array of plugins (e.g., from RSC plugin promise)
        return value as Plugin[];
      }
      if (value && typeof value === 'object' && 'name' in value) {
        return [value as Plugin];
      }
      return [];
    })
  );
  return resolved.flat();
}

describe('timber()', () => {
  it('returns an array of plugin options', () => {
    const options = timber();
    expect(Array.isArray(options)).toBe(true);
    // timber plugins + RSC loader promise
    expect(options.length).toBeGreaterThanOrEqual(11);
  });

  it('timber plugins are present and in correct order', async () => {
    const plugins = await resolvePlugins(timber());
    const names = plugins.map((p) => p.name);

    // timber-root-sync must be first
    expect(names[0]).toBe('timber-root-sync');
    // timber-dev-server must be last
    expect(names[names.length - 1]).toBe('timber-dev-server');

    // All timber sub-plugins must be present
    const timberPlugins = [
      'timber-root-sync',
      'timber-shims',
      'timber-routing',
      'timber-entries',
      'timber-cache',
      'timber-static-build',
      'timber-dynamic-transform',
      'timber-fonts',
      'timber-mdx',
      'timber-content',
      'timber-dev-server',
    ];
    for (const name of timberPlugins) {
      expect(names).toContain(name);
    }

    // timber plugins must appear in correct relative order
    const timberIndices = timberPlugins.map((name) => names.indexOf(name));
    for (let i = 1; i < timberIndices.length; i++) {
      expect(timberIndices[i]).toBeGreaterThan(timberIndices[i - 1]);
    }
  });

  it('includes @vitejs/plugin-rsc plugins', async () => {
    const plugins = await resolvePlugins(timber());
    const names = plugins.map((p) => p.name);
    // RSC plugin registers 'rsc' as its main plugin name
    expect(names).toContain('rsc');
    // "use client" directive handling
    expect(names).toContain('rsc:use-client');
  });

  it('RSC plugins come after root-sync but before timber-shims', async () => {
    const plugins = await resolvePlugins(timber());
    const names = plugins.map((p) => p.name);
    const rootSyncIdx = names.indexOf('timber-root-sync');
    const shimsIdx = names.indexOf('timber-shims');
    const rscIdx = names.indexOf('rsc');
    expect(rscIdx).toBeGreaterThan(rootSyncIdx);
    expect(rscIdx).toBeLessThan(shimsIdx);
  });

  it('accepts user config', () => {
    const options = timber({ output: 'static' });
    expect(options.length).toBeGreaterThanOrEqual(11);
  });
});
