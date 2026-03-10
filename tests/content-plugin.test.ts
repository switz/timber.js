import { describe, it, expect } from 'vitest';
import { timberContent } from '../packages/timber-app/src/plugins/content';
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
    dev: false,
    buildManifest: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// timber-content plugin basics
// ---------------------------------------------------------------------------

describe('timber-content', () => {
  it('has the correct plugin name', () => {
    const plugin = timberContent(createCtx());
    expect(plugin.name).toBe('timber-content');
  });

  it('does not activate when no content-collections config exists', async () => {
    const plugin = timberContent(createCtx());

    // config hook should return undefined when no config file found
    const result = await (plugin.config as Function)?.(
      { root: '/nonexistent-project' },
      { mode: 'development', command: 'serve' }
    );
    expect(result).toBeUndefined();
  });

  it('buildStart is a no-op when not activated', async () => {
    const plugin = timberContent(createCtx());

    // Should not throw even if inner plugin wasn't created
    await (plugin.buildStart as Function)?.({});
  });

  it('configureServer is a no-op when not activated', async () => {
    const plugin = timberContent(createCtx());

    // Should not throw even if inner plugin wasn't created
    await (plugin.configureServer as Function)?.({});
  });

  // -------------------------------------------------------------------------
  // resolveId hook
  // -------------------------------------------------------------------------

  describe('resolveId', () => {
    it('returns null when not activated', async () => {
      const plugin = timberContent(createCtx());
      const result = await (plugin.resolveId as Function)?.('content-collections', undefined, {});
      expect(result).toBeNull();
    });

    it('exposes resolveId as a function', () => {
      const plugin = timberContent(createCtx());
      expect(typeof plugin.resolveId).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // load hook
  // -------------------------------------------------------------------------

  describe('load', () => {
    it('returns null when not activated', async () => {
      const plugin = timberContent(createCtx());
      const result = await (plugin.load as Function)?.('\0content-collections');
      expect(result).toBeNull();
    });

    it('exposes load as a function', () => {
      const plugin = timberContent(createCtx());
      expect(typeof plugin.load).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // transform hook
  // -------------------------------------------------------------------------

  describe('transform', () => {
    it('returns null when not activated', async () => {
      const plugin = timberContent(createCtx());
      const result = await (plugin.transform as Function)?.('export default {}', '/some/file.ts');
      expect(result).toBeNull();
    });

    it('exposes transform as a function', () => {
      const plugin = timberContent(createCtx());
      expect(typeof plugin.transform).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // All hooks are present
  // -------------------------------------------------------------------------

  describe('hook completeness', () => {
    it('delegates all required hooks', () => {
      const plugin = timberContent(createCtx());
      const requiredHooks = [
        'config',
        'configResolved',
        'buildStart',
        'resolveId',
        'load',
        'transform',
        'configureServer',
      ];
      for (const hook of requiredHooks) {
        expect(typeof (plugin as unknown as Record<string, unknown>)[hook]).toBe('function');
      }
    });
  });
});
