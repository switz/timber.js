import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timberEntries } from '../packages/timber-app/src/plugins/entries.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SRC_DIR = resolve(PROJECT_ROOT, 'packages/timber-app/src');

function createPluginContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    config: { output: 'server', ...overrides.config },
    routeTree: null,
    appDir: resolve(PROJECT_ROOT, 'app'),
    root: PROJECT_ROOT,
    dev: false,
    buildManifest: null,
    ...overrides,
  };
}

describe('timber-entries plugin', () => {
  function createResolveId(ctx?: Partial<PluginContext>) {
    const plugin = timberEntries(createPluginContext(ctx));
    return plugin.resolveId as (id: string) => string | null;
  }

  function createLoad(ctx?: Partial<PluginContext>) {
    const plugin = timberEntries(createPluginContext(ctx));
    return plugin.load as (id: string) => string | null;
  }

  describe('resolveId — entry modules', () => {
    it('resolves rsc entry', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'virtual:timber-rsc-entry')).toBe(
        resolve(SRC_DIR, 'server/rsc-entry.ts')
      );
    });

    it('resolves ssr entry', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'virtual:timber-ssr-entry')).toBe(
        resolve(SRC_DIR, 'server/ssr-entry.ts')
      );
    });

    it('resolves browser entry', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'virtual:timber-browser-entry')).toBe(
        resolve(SRC_DIR, 'client/browser-entry.ts')
      );
    });

    it('resolves config module', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'virtual:timber-config')).toBe('\0virtual:timber-config');
    });
  });

  describe('resolveId — null prefix stripping', () => {
    it('strips null prefix from rsc entry', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '\0virtual:timber-rsc-entry')).toBe(
        resolve(SRC_DIR, 'server/rsc-entry.ts')
      );
    });

    it('strips null prefix from ssr entry', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '\0virtual:timber-ssr-entry')).toBe(
        resolve(SRC_DIR, 'server/ssr-entry.ts')
      );
    });

    it('strips null prefix from browser entry', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '\0virtual:timber-browser-entry')).toBe(
        resolve(SRC_DIR, 'client/browser-entry.ts')
      );
    });

    it('strips null prefix from config', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, '\0virtual:timber-config')).toBe('\0virtual:timber-config');
    });
  });

  describe('resolveId — root prefix handling', () => {
    it('handles root prefix for rsc entry', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, `${PROJECT_ROOT}/virtual:timber-rsc-entry`)).toBe(
        resolve(SRC_DIR, 'server/rsc-entry.ts')
      );
    });

    it('handles root prefix for ssr entry', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, `${PROJECT_ROOT}/virtual:timber-ssr-entry`)).toBe(
        resolve(SRC_DIR, 'server/ssr-entry.ts')
      );
    });

    it('handles root prefix for browser entry', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, `${PROJECT_ROOT}/virtual:timber-browser-entry`)).toBe(
        resolve(SRC_DIR, 'client/browser-entry.ts')
      );
    });

    it('handles root prefix for config', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, `${PROJECT_ROOT}/virtual:timber-config`)).toBe(
        '\0virtual:timber-config'
      );
    });
  });

  describe('resolveId — unknown imports pass through', () => {
    it('returns null for unknown virtual module', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'virtual:timber-unknown')).toBeNull();
    });

    it('returns null for unrelated imports', () => {
      const resolveId = createResolveId();
      expect(resolveId.call({}, 'react')).toBeNull();
    });
  });

  describe('load — config serialization', () => {
    it('generates config module with default values', () => {
      const load = createLoad();
      const result = load.call({}, '\0virtual:timber-config');
      expect(result).toContain('export default config');
      expect(result).toContain('"output": "server"');
      expect(result).toContain('"csrf": true');
    });

    it('generates config module with custom output mode', () => {
      const load = createLoad({ config: { output: 'static' } });
      const result = load.call({}, '\0virtual:timber-config');
      expect(result).toContain('"output": "static"');
    });

    it('generates config module with csrf disabled', () => {
      const load = createLoad({ config: { output: 'server', csrf: false } });
      const result = load.call({}, '\0virtual:timber-config');
      expect(result).toContain('"csrf": false');
    });

    it('returns null for non-config module IDs', () => {
      const load = createLoad();
      expect(load.call({}, 'some-other-module')).toBeNull();
    });

    it('returns null for entry file IDs (they are real files)', () => {
      const load = createLoad();
      expect(load.call({}, resolve(SRC_DIR, 'server/rsc-entry.ts'))).toBeNull();
    });
  });

  describe('entry file structure', () => {
    it('rsc entry file exists and is a real TypeScript file', async () => {
      const { existsSync } = await import('node:fs');
      expect(existsSync(resolve(SRC_DIR, 'server/rsc-entry.ts'))).toBe(true);
    });

    it('ssr entry file exists and is a real TypeScript file', async () => {
      const { existsSync } = await import('node:fs');
      expect(existsSync(resolve(SRC_DIR, 'server/ssr-entry.ts'))).toBe(true);
    });

    it('browser entry file exists and is a real TypeScript file', async () => {
      const { existsSync } = await import('node:fs');
      expect(existsSync(resolve(SRC_DIR, 'client/browser-entry.ts'))).toBe(true);
    });

    it('rsc entry imports route manifest and creates request handler', async () => {
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(resolve(SRC_DIR, 'server/rsc-entry.ts'), 'utf-8');
      expect(content).toContain("from 'virtual:timber-route-manifest'");
      expect(content).toContain("from 'virtual:timber-config'");
      expect(content).toContain('createRequestHandler');
      expect(content).toContain('export default');
    });

    it('ssr entry handles RSC stream', async () => {
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(resolve(SRC_DIR, 'server/ssr-entry.ts'), 'utf-8');
      expect(content).toContain("from 'virtual:timber-config'");
      expect(content).toContain('handleSsr');
      expect(content).toContain('rscStream');
      expect(content).toContain('navContext');
      expect(content).toContain('export default');
    });

    it('browser entry bootstraps hydration and segment router', async () => {
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(resolve(SRC_DIR, 'client/browser-entry.ts'), 'utf-8');
      expect(content).toContain("from 'virtual:timber-config'");
      expect(content).toContain('createRouter');
      expect(content).toContain('bootstrap');
      expect(content).toContain('popstate');
    });
  });
});
