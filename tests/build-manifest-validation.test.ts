/**
 * Build manifest validation and 103 Early Hints tests.
 *
 * Tests that the build manifest (step 4 of the pipeline) correctly maps
 * routes to their JS chunks, CSS files, and modulepreload dependencies,
 * and that 103 Early Hints are generated correctly from the manifest.
 *
 * Design docs: 18-build-system.md §"Build Manifest", 25-production-deployments.md §"103 Early Hints"
 * Task: timber-d9a
 */

import { describe, it, expect } from 'vitest';
import { parseViteManifest } from '../packages/timber-app/src/plugins/build-manifest';
import {
  collectRouteCss,
  collectRouteJs,
  collectRouteModulepreloads,
  buildLinkHeaders,
  buildCssLinkTags,
} from '../packages/timber-app/src/server/build-manifest';
import {
  collectEarlyHintHeaders,
  formatLinkHeader,
} from '../packages/timber-app/src/server/early-hints';
import type { BuildManifest } from '../packages/timber-app/src/server/build-manifest';

// ─── Manifest validation ──────────────────────────────────────────────────

describe('manifest validation', () => {
  // Realistic Vite manifest matching the build-test-app fixture structure
  const REALISTIC_MANIFEST = {
    'app/layout.tsx': {
      file: 'assets/layout-abc123.js',
      css: ['assets/root-ghi789.css'],
      imports: ['_react-vendor-111.js'],
    },
    'app/page.tsx': {
      file: 'assets/page-def456.js',
      imports: ['_react-vendor-111.js'],
    },
    'app/about/page.tsx': {
      file: 'assets/about-page-jkl012.js',
      imports: ['_react-vendor-111.js'],
    },
    '_react-vendor-111.js': {
      file: 'assets/react-vendor-111.js',
      imports: ['_scheduler-222.js'],
    },
    '_scheduler-222.js': {
      file: 'assets/scheduler-222.js',
    },
    'virtual:timber-browser-entry': {
      file: 'assets/browser-entry-xyz.js',
      imports: ['_react-vendor-111.js'],
    },
  };

  it('manifest has chunk hashes for all route segments', () => {
    const manifest = parseViteManifest(REALISTIC_MANIFEST, '/');

    expect(manifest.js['app/layout.tsx']).toBe('/assets/layout-abc123.js');
    expect(manifest.js['app/page.tsx']).toBe('/assets/page-def456.js');
    expect(manifest.js['app/about/page.tsx']).toBe('/assets/about-page-jkl012.js');
    expect(manifest.js['virtual:timber-browser-entry']).toBe('/assets/browser-entry-xyz.js');
  });

  it('manifest has CSS mappings', () => {
    const manifest = parseViteManifest(REALISTIC_MANIFEST, '/');

    expect(manifest.css['app/layout.tsx']).toEqual(['/assets/root-ghi789.css']);
    expect(manifest.css['app/page.tsx']).toBeUndefined(); // page has no CSS
  });

  it('manifest has route→chunk associations via segment chain', () => {
    const manifest = parseViteManifest(REALISTIC_MANIFEST, '/');

    // Home route: layout + page
    const homeSegments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/page.tsx' } },
    ];
    const homeJs = collectRouteJs(homeSegments, manifest);
    expect(homeJs).toEqual(['/assets/layout-abc123.js', '/assets/page-def456.js']);

    // About route: layout + about/page
    const aboutSegments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/about/page.tsx' } },
    ];
    const aboutJs = collectRouteJs(aboutSegments, manifest);
    expect(aboutJs).toEqual(['/assets/layout-abc123.js', '/assets/about-page-jkl012.js']);
  });

  it('manifest modulepreload includes transitive deps', () => {
    const manifest = parseViteManifest(REALISTIC_MANIFEST, '/');

    // Layout should preload react-vendor and scheduler
    expect(manifest.modulepreload['app/layout.tsx']).toEqual([
      '/assets/react-vendor-111.js',
      '/assets/scheduler-222.js',
    ]);

    // Browser entry also needs react-vendor and scheduler
    expect(manifest.modulepreload['virtual:timber-browser-entry']).toEqual([
      '/assets/react-vendor-111.js',
      '/assets/scheduler-222.js',
    ]);
  });

  it('collectRouteCss deduplicates CSS across segments', () => {
    const manifest = parseViteManifest(REALISTIC_MANIFEST, '/');

    const segments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/page.tsx' } },
    ];
    const css = collectRouteCss(segments, manifest);

    // Only layout has CSS
    expect(css).toEqual(['/assets/root-ghi789.css']);
  });

  it('collectRouteModulepreloads deduplicates across segments', () => {
    const manifest = parseViteManifest(REALISTIC_MANIFEST, '/');

    const segments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/page.tsx' } },
    ];
    const preloads = collectRouteModulepreloads(segments, manifest);

    // Both layout and page depend on react-vendor → scheduler
    // But they should be deduplicated
    expect(preloads).toEqual(['/assets/react-vendor-111.js', '/assets/scheduler-222.js']);
  });

  it('buildLinkHeaders generates preload headers for CDN', () => {
    const cssUrls = ['/assets/root-ghi789.css', '/assets/page-abc.css'];
    const headers = buildLinkHeaders(cssUrls);

    expect(headers).toBe(
      '</assets/root-ghi789.css>; rel=preload; as=style, </assets/page-abc.css>; rel=preload; as=style'
    );
  });

  it('buildCssLinkTags generates stylesheet links', () => {
    const cssUrls = ['/assets/root-ghi789.css'];
    const tags = buildCssLinkTags(cssUrls);

    expect(tags).toBe('<link rel="stylesheet" href="/assets/root-ghi789.css">');
  });

  it('base path is applied to all manifest URLs', () => {
    const manifest = parseViteManifest(REALISTIC_MANIFEST, '/my-app/');

    expect(manifest.js['app/layout.tsx']).toBe('/my-app/assets/layout-abc123.js');
    expect(manifest.css['app/layout.tsx']).toEqual(['/my-app/assets/root-ghi789.css']);
    expect(manifest.modulepreload['app/layout.tsx']).toEqual([
      '/my-app/assets/react-vendor-111.js',
      '/my-app/assets/scheduler-222.js',
    ]);
  });
});

// ─── 103 Early Hints ──────────────────────────────────────────────────────

describe('103 Early Hints from manifest', () => {
  const MANIFEST_WITH_FONTS: BuildManifest = {
    css: {
      'app/layout.tsx': ['/assets/root.css'],
    },
    js: {
      'app/layout.tsx': '/assets/layout.js',
      'app/page.tsx': '/assets/page.js',
    },
    modulepreload: {
      'app/layout.tsx': ['/assets/react-vendor.js'],
      'app/page.tsx': ['/assets/react-vendor.js', '/assets/utils.js'],
    },
    fonts: {
      'app/layout.tsx': [
        { href: '/fonts/inter-400.woff2', format: 'woff2', crossOrigin: 'anonymous' },
      ],
    },
  };

  it('collects CSS, font, and modulepreload hints for a route', () => {
    const segments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/page.tsx' } },
    ];

    const hints = collectEarlyHintHeaders(segments, MANIFEST_WITH_FONTS);

    // CSS hint
    expect(hints).toContainEqual('</assets/root.css>; rel=preload; as=style');
    // Font hint
    expect(hints).toContainEqual(
      '</fonts/inter-400.woff2>; rel=preload; as=font; crossorigin=anonymous'
    );
    // Modulepreload hints (deduplicated)
    expect(hints).toContainEqual('</assets/react-vendor.js>; rel=modulepreload');
    expect(hints).toContainEqual('</assets/utils.js>; rel=modulepreload');
  });

  it('deduplicates hints across segments', () => {
    const segments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/page.tsx' } },
    ];

    const hints = collectEarlyHintHeaders(segments, MANIFEST_WITH_FONTS);

    // react-vendor appears in both layout and page modulepreloads
    const vendorHints = hints.filter((h) => h.includes('react-vendor'));
    expect(vendorHints).toHaveLength(1);
  });

  it('returns empty array for empty manifest (dev mode)', () => {
    const segments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/page.tsx' } },
    ];

    const hints = collectEarlyHintHeaders(segments, {
      css: {},
      js: {},
      modulepreload: {},
      fonts: {},
    });

    expect(hints).toEqual([]);
  });

  it('formatLinkHeader generates correct format', () => {
    expect(formatLinkHeader({ href: '/style.css', rel: 'preload', as: 'style' })).toBe(
      '</style.css>; rel=preload; as=style'
    );

    expect(
      formatLinkHeader({
        href: '/font.woff2',
        rel: 'preload',
        as: 'font',
        crossOrigin: 'anonymous',
      })
    ).toBe('</font.woff2>; rel=preload; as=font; crossorigin=anonymous');

    expect(formatLinkHeader({ href: '/chunk.js', rel: 'modulepreload' })).toBe(
      '</chunk.js>; rel=modulepreload'
    );
  });
});
