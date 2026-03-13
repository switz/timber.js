import { describe, it, expect } from 'vitest';
import { parseViteManifest } from '../packages/timber-app/src/plugins/build-manifest';
import {
  collectRouteJs,
  collectRouteModulepreloads,
  buildModulepreloadTags,
  buildEntryScriptTag,
} from '../packages/timber-app/src/server/build-manifest';
import type { BuildManifest } from '../packages/timber-app/src/server/build-manifest';
import { buildClientScripts } from '../packages/timber-app/src/server/html-injectors';

// ─── parseViteManifest: JS chunks ─────────────────────────────────────────

describe('parseViteManifest() — JS chunks', () => {
  it('client manifest maps modules to hashed filenames', () => {
    const viteManifest = {
      'app/layout.tsx': {
        file: 'assets/layout-abc123.js',
        css: ['assets/layout-abc123.css'],
        imports: ['_shared-def456.js'],
      },
      'app/page.tsx': {
        file: 'assets/page-ghi789.js',
        imports: ['_shared-def456.js'],
      },
      '_shared-def456.js': {
        file: 'assets/shared-def456.js',
      },
      'virtual:timber-browser-entry': {
        file: 'assets/browser-entry-xyz.js',
        imports: ['_shared-def456.js'],
      },
    };

    const result = parseViteManifest(viteManifest, '/');

    // JS mapping should include hashed filenames
    expect(result.js['app/layout.tsx']).toBe('/assets/layout-abc123.js');
    expect(result.js['app/page.tsx']).toBe('/assets/page-ghi789.js');
    expect(result.js['virtual:timber-browser-entry']).toBe('/assets/browser-entry-xyz.js');
  });

  it('client chunks exist with correct hashed paths', () => {
    const viteManifest = {
      'app/dashboard/page.tsx': {
        file: 'assets/dashboard-page-abc.js',
      },
      'app/settings/page.tsx': {
        file: 'assets/settings-page-def.js',
      },
    };

    const result = parseViteManifest(viteManifest, '/');

    expect(Object.keys(result.js)).toHaveLength(2);
    expect(result.js['app/dashboard/page.tsx']).toBe('/assets/dashboard-page-abc.js');
    expect(result.js['app/settings/page.tsx']).toBe('/assets/settings-page-def.js');
  });

  it('applies base path to JS URLs', () => {
    const viteManifest = {
      'virtual:timber-browser-entry': {
        file: 'assets/entry.js',
      },
    };

    const result = parseViteManifest(viteManifest, '/my-app/');
    expect(result.js['virtual:timber-browser-entry']).toBe('/my-app/assets/entry.js');
  });
});

// ─── parseViteManifest: modulepreload ──────────────────────────────────────

describe('parseViteManifest() — modulepreload', () => {
  it('modulepreload includes dependencies', () => {
    const viteManifest = {
      'virtual:timber-browser-entry': {
        file: 'assets/entry-abc.js',
        imports: ['_react-vendor-def.js'],
      },
      '_react-vendor-def.js': {
        file: 'assets/react-vendor-def.js',
        imports: ['_scheduler-ghi.js'],
      },
      '_scheduler-ghi.js': {
        file: 'assets/scheduler-ghi.js',
      },
    };

    const result = parseViteManifest(viteManifest, '/');

    expect(result.modulepreload['virtual:timber-browser-entry']).toEqual([
      '/assets/react-vendor-def.js',
      '/assets/scheduler-ghi.js',
    ]);
  });

  it('deduplicates transitive dependencies', () => {
    const viteManifest = {
      'app/page.tsx': {
        file: 'assets/page.js',
        imports: ['_a.js', '_b.js'],
      },
      '_a.js': {
        file: 'assets/a.js',
        imports: ['_shared.js'],
      },
      '_b.js': {
        file: 'assets/b.js',
        imports: ['_shared.js'],
      },
      '_shared.js': {
        file: 'assets/shared.js',
      },
    };

    const result = parseViteManifest(viteManifest, '/');
    const preloads = result.modulepreload['app/page.tsx'];

    // shared.js should appear only once
    expect(preloads.filter((p) => p.includes('shared'))).toHaveLength(1);
    expect(preloads).toHaveLength(3); // a, b, shared
  });

  it('returns empty array for entries with no imports', () => {
    const viteManifest = {
      'app/page.tsx': {
        file: 'assets/page.js',
      },
    };

    const result = parseViteManifest(viteManifest, '/');
    expect(result.modulepreload['app/page.tsx']).toEqual([]);
  });
});

// ─── collectRouteJs ────────────────────────────────────────────────────────

describe('collectRouteJs()', () => {
  it('routes load only their required chunks', () => {
    const manifest: BuildManifest = {
      css: {},
      js: {
        'app/layout.tsx': '/assets/layout-abc.js',
        'app/dashboard/page.tsx': '/assets/dashboard-def.js',
        'app/settings/page.tsx': '/assets/settings-ghi.js',
      },
      modulepreload: {},
      fonts: {},
    };

    const dashboardSegments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/dashboard/page.tsx' } },
    ];

    const result = collectRouteJs(dashboardSegments, manifest);
    expect(result).toEqual(['/assets/layout-abc.js', '/assets/dashboard-def.js']);
    // settings page chunk is NOT included
    expect(result).not.toContain('/assets/settings-ghi.js');
  });

  it('returns empty array for dev mode (empty manifest)', () => {
    const manifest: BuildManifest = { css: {}, js: {}, modulepreload: {}, fonts: {} };
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];
    expect(collectRouteJs(segments, manifest)).toEqual([]);
  });
});

// ─── collectRouteModulepreloads ────────────────────────────────────────────

describe('collectRouteModulepreloads()', () => {
  it('collects modulepreload URLs for route segments', () => {
    const manifest: BuildManifest = {
      css: {},
      js: {
        'app/layout.tsx': '/assets/layout.js',
        'app/page.tsx': '/assets/page.js',
      },
      modulepreload: {
        'app/layout.tsx': ['/assets/react-vendor.js'],
        'app/page.tsx': ['/assets/react-vendor.js', '/assets/utils.js'],
      },
      fonts: {},
    };

    const segments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/page.tsx' } },
    ];

    const result = collectRouteModulepreloads(segments, manifest);
    // Deduplicated across segments
    expect(result).toEqual(['/assets/react-vendor.js', '/assets/utils.js']);
  });
});

// ─── buildModulepreloadTags ────────────────────────────────────────────────

describe('buildModulepreloadTags()', () => {
  it('modulepreload links included for dependencies', () => {
    const urls = ['/assets/react-vendor.js', '/assets/utils.js'];
    const result = buildModulepreloadTags(urls);

    expect(result).toBe(
      '<link rel="modulepreload" href="/assets/react-vendor.js">' +
        '<link rel="modulepreload" href="/assets/utils.js">'
    );
  });

  it('returns empty string for no URLs', () => {
    expect(buildModulepreloadTags([])).toBe('');
  });
});

// ─── buildEntryScriptTag ───────────────────────────────────────────────────

describe('buildEntryScriptTag()', () => {
  it('generates script tag with hashed URL', () => {
    const result = buildEntryScriptTag('/assets/browser-entry-abc123.js');
    expect(result).toBe('<script type="module" src="/assets/browser-entry-abc123.js"></script>');
  });
});

// ─── buildClientScripts (production) ───────────────────────────────────────

describe('buildClientScripts() — production', () => {
  it('uses dynamic import() with hashed URL (not virtual paths)', () => {
    const manifest: BuildManifest = {
      css: {},
      js: {
        'virtual:timber-browser-entry': '/assets/entry-abc123.js',
      },
      modulepreload: {
        'virtual:timber-browser-entry': ['/assets/react-vendor.js'],
      },
      fonts: {},
    };

    const result = buildClientScripts({
      output: 'server',
      noClientJavascript: false,
      dev: false,
      buildManifest: manifest,
    });

    // Should use dynamic import() with hashed URL
    expect(result.bootstrapScriptContent).toBe('import("/assets/entry-abc123.js")');
    expect(result.bootstrapScriptContent).not.toContain('virtual:timber-browser-entry');
    expect(result.bootstrapScriptContent).not.toContain('/@id/');
  });

  it('includes modulepreload links for browser entry deps', () => {
    const manifest: BuildManifest = {
      css: {},
      js: {
        'virtual:timber-browser-entry': '/assets/entry.js',
      },
      modulepreload: {
        'virtual:timber-browser-entry': ['/assets/react-vendor.js', '/assets/router.js'],
      },
      fonts: {},
    };

    const result = buildClientScripts({
      output: 'server',
      noClientJavascript: false,
      dev: false,
      buildManifest: manifest,
    });

    expect(result.preloadLinks).toContain(
      '<link rel="modulepreload" href="/assets/react-vendor.js">'
    );
    expect(result.preloadLinks).toContain('<link rel="modulepreload" href="/assets/router.js">');
  });

  it('dev mode uses dynamic import() with virtual module paths', () => {
    const result = buildClientScripts({
      output: 'server',
      noClientJavascript: false,
      dev: true,
    });

    // Dev mode imports the RSC plugin's virtual browser entry, which sets up
    // React Fast Refresh preamble before dynamically importing our browser entry.
    expect(result.bootstrapScriptContent).toContain(
      'import("/@id/__x00__virtual:vite-rsc/entry-browser")'
    );
    expect(result.bootstrapScriptContent).toContain('import("/@vite/client")');
  });

  it('noClientJavascript mode returns empty config', () => {
    const result = buildClientScripts({
      output: 'static',
      noClientJavascript: true,
      dev: false,
    });

    expect(result.bootstrapScriptContent).toBe('');
    expect(result.preloadLinks).toBe('');
  });

  it('falls back to virtual path when no manifest entry exists', () => {
    const manifest: BuildManifest = {
      css: {},
      js: {},
      modulepreload: {},
      fonts: {},
    };

    const result = buildClientScripts({
      output: 'server',
      noClientJavascript: false,
      dev: false,
      buildManifest: manifest,
    });

    // Fallback to non-dev virtual path via dynamic import()
    expect(result.bootstrapScriptContent).toContain('virtual:timber-browser-entry');
  });
});
