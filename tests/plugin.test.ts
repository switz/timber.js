import { describe, it, expect } from 'vitest';
import { timber } from '@timber/app';

describe('timber()', () => {
  it('returns an array of Vite plugins', () => {
    const plugins = timber();
    expect(Array.isArray(plugins)).toBe(true);
    // At least 11 timber plugins + RSC plugins
    expect(plugins.length).toBeGreaterThanOrEqual(11);
  });

  it('timber plugins are present and in correct order', () => {
    const plugins = timber();
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

  it('includes @vitejs/plugin-rsc plugins', () => {
    const plugins = timber();
    const names = plugins.map((p) => p.name);
    // RSC plugin registers 'rsc' as its main plugin name
    expect(names).toContain('rsc');
    // "use client" directive handling
    expect(names).toContain('rsc:use-client');
  });

  it('RSC plugins come after root-sync but before timber-shims', () => {
    const plugins = timber();
    const names = plugins.map((p) => p.name);
    const rootSyncIdx = names.indexOf('timber-root-sync');
    const shimsIdx = names.indexOf('timber-shims');
    const rscIdx = names.indexOf('rsc');
    expect(rscIdx).toBeGreaterThan(rootSyncIdx);
    expect(rscIdx).toBeLessThan(shimsIdx);
  });

  it('accepts user config', () => {
    const plugins = timber({ output: 'static' });
    expect(plugins.length).toBeGreaterThanOrEqual(11);
  });
});
