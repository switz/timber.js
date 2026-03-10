import { describe, it, expect } from 'vitest';
import { timber } from '@timber/app';

describe('timber()', () => {
  it('returns an array of Vite plugins', () => {
    const plugins = timber();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBe(11);
  });

  it('each plugin has a name', () => {
    const plugins = timber();
    const names = plugins.map((p) => p.name);
    expect(names).toEqual([
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
      'timber-dev-server', // Must be last — see 21-dev-server.md §Plugin Registration
    ]);
  });

  it('accepts user config', () => {
    const plugins = timber({ output: 'static' });
    expect(plugins.length).toBe(11);
  });
});
