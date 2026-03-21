/**
 * Tests for timber-server-bundle plugin.
 *
 * Verifies that server environments (rsc, ssr) are configured correctly
 * for both dev and production modes — bundling, externalization, and
 * Node.js builtin availability.
 *
 * Ported from LOCAL-327: RSC environment must have Node.js builtins
 * (AsyncLocalStorage, crypto, fs) available in server components.
 */
import { describe, it, expect } from 'vitest';
import { timberServerBundle } from '#/plugins/server-bundle';

describe('timberServerBundle', () => {
  it('returns an array of plugins', () => {
    const plugins = timberServerBundle();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThanOrEqual(1);
  });

  it('has correct plugin names', () => {
    const plugins = timberServerBundle();
    const names = plugins.map((p) => p.name);
    expect(names).toContain('timber-server-bundle');
    expect(names).toContain('timber-esm-init-fix');
  });

  describe('dev mode (serve)', () => {
    it('sets server-only and client-only as noExternal for RSC', () => {
      const plugins = timberServerBundle();
      const bundlePlugin = plugins.find((p) => p.name === 'timber-server-bundle')!;
      const configHook = bundlePlugin.config as Function;
      const result = configHook({}, { command: 'serve' });

      expect(result.environments.rsc.resolve.noExternal).toContain('server-only');
      expect(result.environments.rsc.resolve.noExternal).toContain('client-only');
    });

    it('does NOT set ssr.target to webworker in dev', () => {
      const plugins = timberServerBundle();
      const bundlePlugin = plugins.find((p) => p.name === 'timber-server-bundle')!;
      const configHook = bundlePlugin.config as Function;
      const result = configHook({}, { command: 'serve' });

      // In dev, ssr.target must NOT be 'webworker' — that would cause Vite to
      // clear the builtins list, making node:async_hooks etc. unavailable.
      expect(result.ssr?.target).toBeUndefined();
    });

    it('does NOT set noExternal: true in dev (preserves fast HMR)', () => {
      const plugins = timberServerBundle();
      const bundlePlugin = plugins.find((p) => p.name === 'timber-server-bundle')!;
      const configHook = bundlePlugin.config as Function;
      const result = configHook({}, { command: 'serve' });

      // In dev, node_modules should be externalized (loaded via Node's require)
      // for fast HMR. Only specific packages are forced non-external.
      expect(result.environments.rsc.resolve.noExternal).not.toBe(true);
      expect(result.environments.ssr.resolve.noExternal).not.toBe(true);
    });
  });

  describe('production build', () => {
    it('bundles all deps in server environments', () => {
      const plugins = timberServerBundle();
      const bundlePlugin = plugins.find((p) => p.name === 'timber-server-bundle')!;
      const configHook = bundlePlugin.config as Function;
      const result = configHook({}, { command: 'build' });

      expect(result.environments.rsc.resolve.noExternal).toBe(true);
      expect(result.environments.ssr.resolve.noExternal).toBe(true);
    });

    it('targets webworker for Cloudflare Workers compatibility', () => {
      const plugins = timberServerBundle();
      const bundlePlugin = plugins.find((p) => p.name === 'timber-server-bundle')!;
      const configHook = bundlePlugin.config as Function;
      const result = configHook({}, { command: 'build' });

      expect(result.ssr.target).toBe('webworker');
    });

    it('defines process.env.NODE_ENV for server environments', () => {
      const plugins = timberServerBundle();
      const bundlePlugin = plugins.find((p) => p.name === 'timber-server-bundle')!;
      const configHook = bundlePlugin.config as Function;
      const result = configHook({}, { command: 'build' });

      expect(result.environments.rsc.define['process.env.NODE_ENV']).toBe('"production"');
      expect(result.environments.ssr.define['process.env.NODE_ENV']).toBe('"production"');
    });
  });

  describe('esm init fix', () => {
    it('only applies to rsc and ssr environments', () => {
      const plugins = timberServerBundle();
      const esmPlugin = plugins.find((p) => p.name === 'timber-esm-init-fix')!;
      const applyFn = esmPlugin.applyToEnvironment as Function;

      expect(applyFn({ name: 'rsc' })).toBe(true);
      expect(applyFn({ name: 'ssr' })).toBe(true);
      expect(applyFn({ name: 'client' })).toBe(false);
    });

    it('replaces lazy __esmMin with eager-with-retry variant', () => {
      const plugins = timberServerBundle();
      const esmPlugin = plugins.find((p) => p.name === 'timber-esm-init-fix')!;
      const renderChunk = esmPlugin.renderChunk as Function;

      const lazy = 'var __esmMin = (fn, res) => () => (fn && (res = fn(fn = 0)), res);';
      const code = `${lazy}\nvar init_foo = __esmMin(() => {});`;
      const result = renderChunk(code);

      expect(result).not.toBeNull();
      expect(result.code).not.toContain(lazy);
      expect(result.code).toContain('try');
      expect(result.code).toContain('catch');
    });

    it('returns null when __esmMin is not present', () => {
      const plugins = timberServerBundle();
      const esmPlugin = plugins.find((p) => p.name === 'timber-esm-init-fix')!;
      const renderChunk = esmPlugin.renderChunk as Function;

      const result = renderChunk('const x = 1;');
      expect(result).toBeNull();
    });
  });
});
