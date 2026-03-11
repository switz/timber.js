import { describe, it, expect } from 'vitest';
import {
  collectRouteCss,
  buildCssLinkTags,
  buildLinkHeaders,
  EMPTY_BUILD_MANIFEST,
} from '../packages/timber-app/src/server/build-manifest';
import type { BuildManifest } from '../packages/timber-app/src/server/build-manifest';
import { parseViteManifest } from '../packages/timber-app/src/plugins/build-manifest';

// ─── collectRouteCss ──────────────────────────────────────────────────────

describe('collectRouteCss()', () => {
  const manifest: BuildManifest = {
    css: {
      '/app/layout.tsx': ['/assets/root-abc.css'],
      '/app/dashboard/layout.tsx': ['/assets/dashboard-def.css'],
      '/app/dashboard/page.tsx': ['/assets/page-ghi.css'],
    },
    js: {},
    modulepreload: {},
    fonts: {},
  };

  it('collects CSS from layout and page file paths', () => {
    const segments = [
      { layout: { filePath: '/app/layout.tsx' } },
      {
        layout: { filePath: '/app/dashboard/layout.tsx' },
        page: { filePath: '/app/dashboard/page.tsx' },
      },
    ];

    const result = collectRouteCss(segments, manifest);
    expect(result).toEqual([
      '/assets/root-abc.css',
      '/assets/dashboard-def.css',
      '/assets/page-ghi.css',
    ]);
  });

  it('preserves root-to-leaf ordering', () => {
    const segments = [
      { layout: { filePath: '/app/layout.tsx' } },
      { layout: { filePath: '/app/dashboard/layout.tsx' } },
    ];

    const result = collectRouteCss(segments, manifest);
    expect(result).toEqual(['/assets/root-abc.css', '/assets/dashboard-def.css']);
  });

  it('deduplicates shared CSS files', () => {
    const sharedManifest: BuildManifest = {
      css: {
        '/app/layout.tsx': ['/assets/shared.css', '/assets/root.css'],
        '/app/page.tsx': ['/assets/shared.css', '/assets/page.css'],
      },
      js: {},
      modulepreload: {},
      fonts: {},
    };

    const segments = [
      {
        layout: { filePath: '/app/layout.tsx' },
        page: { filePath: '/app/page.tsx' },
      },
    ];

    const result = collectRouteCss(segments, sharedManifest);
    expect(result).toEqual(['/assets/shared.css', '/assets/root.css', '/assets/page.css']);
  });

  it('returns empty array for empty manifest (dev mode)', () => {
    const segments = [
      { layout: { filePath: '/app/layout.tsx' } },
      { page: { filePath: '/app/page.tsx' } },
    ];

    const result = collectRouteCss(segments, EMPTY_BUILD_MANIFEST);
    expect(result).toEqual([]);
  });

  it('skips segments without layout or page', () => {
    const segments = [
      { layout: { filePath: '/app/layout.tsx' } },
      {}, // group segment with no files
      { page: { filePath: '/app/dashboard/page.tsx' } },
    ];

    const result = collectRouteCss(segments, manifest);
    expect(result).toEqual(['/assets/root-abc.css', '/assets/page-ghi.css']);
  });

  it('skips files not in manifest', () => {
    const segments = [
      { layout: { filePath: '/app/unknown/layout.tsx' } },
    ];

    const result = collectRouteCss(segments, manifest);
    expect(result).toEqual([]);
  });
});

// ─── buildCssLinkTags ─────────────────────────────────────────────────────

describe('buildCssLinkTags()', () => {
  it('generates link tags for CSS URLs', () => {
    const result = buildCssLinkTags(['/assets/root.css', '/assets/page.css']);
    expect(result).toBe(
      '<link rel="stylesheet" href="/assets/root.css">' +
      '<link rel="stylesheet" href="/assets/page.css">'
    );
  });

  it('returns empty string for empty array', () => {
    expect(buildCssLinkTags([])).toBe('');
  });
});

// ─── buildLinkHeaders ─────────────────────────────────────────────────────

describe('buildLinkHeaders()', () => {
  it('generates Link header value for preload hints', () => {
    const result = buildLinkHeaders(['/assets/root.css', '/assets/page.css']);
    expect(result).toBe(
      '</assets/root.css>; rel=preload; as=style, </assets/page.css>; rel=preload; as=style'
    );
  });

  it('returns empty string for empty array', () => {
    expect(buildLinkHeaders([])).toBe('');
  });
});

// ─── parseViteManifest ────────────────────────────────────────────────────

describe('parseViteManifest()', () => {
  it('extracts CSS mappings from Vite manifest', () => {
    const viteManifest = {
      'app/layout.tsx': {
        file: 'assets/layout-abc.js',
        css: ['assets/layout-abc.css'],
      },
      'app/page.tsx': {
        file: 'assets/page-def.js',
        css: ['assets/page-def.css', 'assets/shared-ghi.css'],
      },
      'app/about/page.tsx': {
        file: 'assets/about-jkl.js',
        // No CSS
      },
    };

    const result = parseViteManifest(viteManifest, '/');
    expect(result.css).toEqual({
      'app/layout.tsx': ['/assets/layout-abc.css'],
      'app/page.tsx': ['/assets/page-def.css', '/assets/shared-ghi.css'],
    });
    // JS chunks are also extracted
    expect(result.js['app/layout.tsx']).toBe('/assets/layout-abc.js');
    expect(result.js['app/page.tsx']).toBe('/assets/page-def.js');
    expect(result.js['app/about/page.tsx']).toBe('/assets/about-jkl.js');
  });

  it('applies base path to CSS URLs', () => {
    const viteManifest = {
      'app/layout.tsx': {
        file: 'assets/layout.js',
        css: ['assets/layout.css'],
      },
    };

    const result = parseViteManifest(viteManifest, '/my-app/');
    expect(result.css['app/layout.tsx']).toEqual(['/my-app/assets/layout.css']);
  });

  it('returns empty css for entries without CSS', () => {
    const viteManifest = {
      'app/layout.tsx': { file: 'assets/layout.js' },
    };

    const result = parseViteManifest(viteManifest, '/');
    expect(result.css).toEqual({});
    // JS chunk is still extracted
    expect(result.js['app/layout.tsx']).toBe('/assets/layout.js');
  });
});
