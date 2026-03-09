import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timberShims } from '../packages/timber-app/src/plugins/shims.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SHIMS_DIR = resolve(PROJECT_ROOT, 'packages/timber-app/src/shims');
const SRC_DIR = resolve(PROJECT_ROOT, 'packages/timber-app/src');

function createPluginContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    config: { output: 'server', ...overrides.config },
    routeTree: null,
    appDir: resolve(PROJECT_ROOT, 'app'),
    root: PROJECT_ROOT,
    ...overrides,
  };
}

describe('timber-shims plugin', () => {
  function createResolveId() {
    const ctx = createPluginContext();
    const plugin = timberShims(ctx);
    return plugin.resolveId as (id: string) => string | null;
  }

  describe('resolveId — next/* shim map', () => {
    it('resolves next/link', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/link')).toBe(resolve(SHIMS_DIR, 'link.ts'));
    });

    it('resolves next/image', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/image')).toBe(resolve(SHIMS_DIR, 'image.ts'));
    });

    it('resolves next/navigation', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/navigation')).toBe(resolve(SHIMS_DIR, 'navigation.ts'));
    });

    it('resolves next/headers', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/headers')).toBe(resolve(SHIMS_DIR, 'headers.ts'));
    });

    it('resolves next/font/google', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/font/google')).toBe(resolve(SHIMS_DIR, 'font-google.ts'));
    });
  });

  describe('resolveId — .js extension stripping', () => {
    it('strips .js extension for next/navigation.js', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/navigation.js')).toBe(resolve(SHIMS_DIR, 'navigation.ts'));
    });

    it('strips .js extension for next/link.js', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/link.js')).toBe(resolve(SHIMS_DIR, 'link.ts'));
    });

    it('strips .js extension for next/headers.js', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/headers.js')).toBe(resolve(SHIMS_DIR, 'headers.ts'));
    });

    it('strips .js extension for next/image.js', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/image.js')).toBe(resolve(SHIMS_DIR, 'image.ts'));
    });
  });

  describe('resolveId — @timber/app/* subpaths', () => {
    it('resolves @timber/app/server', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '@timber/app/server')).toBe(resolve(SRC_DIR, 'server/index.ts'));
    });

    it('resolves @timber/app/client', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '@timber/app/client')).toBe(resolve(SRC_DIR, 'client/index.ts'));
    });

    it('resolves @timber/app/cache', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '@timber/app/cache')).toBe(resolve(SRC_DIR, 'cache/index.ts'));
    });

    it('resolves @timber/app/search-params', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '@timber/app/search-params')).toBe(
        resolve(SRC_DIR, 'search-params/index.ts'),
      );
    });

    it('resolves @timber/app/routing', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '@timber/app/routing')).toBe(resolve(SRC_DIR, 'routing/index.ts'));
    });
  });

  describe('resolveId — unknown imports pass through', () => {
    it('returns null for unknown next/* import', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/unknown-module')).toBeNull();
    });

    it('returns null for next/router (not shimmed)', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'next/router')).toBeNull();
    });

    it('returns null for unrelated imports', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'react')).toBeNull();
    });

    it('returns null for unknown @timber/app/* subpath', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '@timber/app/nonexistent')).toBeNull();
    });
  });

  describe('shim re-exports', () => {
    it('link shim exports Link as default', async () => {
      const mod = await import('../packages/timber-app/src/shims/link.js');
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe('function');
      expect(mod.Link).toBe(mod.default);
    });

    it('image shim exports Image as default', async () => {
      const mod = await import('../packages/timber-app/src/shims/image.js');
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe('function');
      expect(mod.Image).toBe(mod.default);
    });

    it('navigation shim exports redirect', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof mod.redirect).toBe('function');
    });

    it('navigation shim exports useParams', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof mod.useParams).toBe('function');
    });

    it('headers shim exports headers() that throws with migration hint', async () => {
      const mod = await import('../packages/timber-app/src/shims/headers.js');
      expect(() => mod.headers()).toThrow('not available in timber.js');
    });

    it('headers shim exports cookies() that throws with migration hint', async () => {
      const mod = await import('../packages/timber-app/src/shims/headers.js');
      expect(() => mod.cookies()).toThrow('not available in timber.js');
    });

    it('font-google shim exports a default font loader function', async () => {
      const mod = await import('../packages/timber-app/src/shims/font-google.js');
      expect(typeof mod.default).toBe('function');
      const result = mod.default({ weight: '400', subsets: ['latin'] });
      expect(result).toHaveProperty('className');
      expect(result).toHaveProperty('style');
      expect(result.style).toHaveProperty('fontFamily');
    });
  });
});
