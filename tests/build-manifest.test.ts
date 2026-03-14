import { describe, it, expect } from 'vitest';
import {
  collectRouteCss,
  buildCssLinkTags,
  buildLinkHeaders,
  EMPTY_BUILD_MANIFEST,
} from '../packages/timber-app/src/server/build-manifest';
import type { BuildManifest } from '../packages/timber-app/src/server/build-manifest';
import {
  parseViteManifest,
  buildManifestFromBundle,
} from '../packages/timber-app/src/plugins/build-manifest';

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
    const segments = [{ layout: { filePath: '/app/unknown/layout.tsx' } }];

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

// ─── buildManifestFromBundle ──────────────────────────────────────────────

// Minimal mock types matching the internal types in build-manifest.ts
interface MockChunk {
  type: 'chunk';
  fileName: string;
  facadeModuleId: string | null;
  imports: string[];
  name: string;
  code: string;
  viteMetadata?: { importedCss?: Set<string> };
}

interface MockAsset {
  type: 'asset';
  fileName: string;
}

type MockBundle = Record<string, MockChunk | MockAsset>;

function mockChunk(overrides: Partial<MockChunk> & { fileName: string }): MockChunk {
  return {
    type: 'chunk',
    code: '',
    facadeModuleId: null,
    imports: [],
    name: overrides.fileName.replace(/\.js$/, ''),
    ...overrides,
  };
}

function mockAsset(fileName: string): MockAsset {
  return { type: 'asset', fileName };
}

describe('buildManifestFromBundle()', () => {
  it('extracts JS mappings from chunks with facadeModuleId', () => {
    const bundle: MockBundle = {
      'assets/layout-abc.js': mockChunk({
        fileName: 'assets/layout-abc.js',
        facadeModuleId: '/project/app/layout.tsx',
      }),
      'assets/page-def.js': mockChunk({
        fileName: 'assets/page-def.js',
        facadeModuleId: '/project/app/page.tsx',
      }),
    };

    const result = buildManifestFromBundle(bundle, '/', '/project');
    expect(result.js['app/layout.tsx']).toBe('/assets/layout-abc.js');
    expect(result.js['app/page.tsx']).toBe('/assets/page-def.js');
  });

  it('extracts CSS from viteMetadata.importedCss', () => {
    const chunk = mockChunk({
      fileName: 'assets/layout-abc.js',
      facadeModuleId: '/project/app/layout.tsx',
    });
    chunk.viteMetadata = {
      importedCss: new Set(['assets/layout-abc.css', 'assets/shared.css']),
    };

    const bundle: MockBundle = {
      'assets/layout-abc.js': chunk,
      'assets/layout-abc.css': mockAsset('assets/layout-abc.css'),
      'assets/shared.css': mockAsset('assets/shared.css'),
    };

    const result = buildManifestFromBundle(bundle, '/', '/project');
    expect(result.css['app/layout.tsx']).toEqual(['/assets/layout-abc.css', '/assets/shared.css']);
  });

  it('applies base path to all URLs', () => {
    const chunk = mockChunk({
      fileName: 'assets/layout.js',
      facadeModuleId: '/project/app/layout.tsx',
    });
    chunk.viteMetadata = {
      importedCss: new Set(['assets/layout.css']),
    };

    const bundle: MockBundle = {
      'assets/layout.js': chunk,
    };

    const result = buildManifestFromBundle(bundle, '/my-app/', '/project');
    expect(result.js['app/layout.tsx']).toBe('/my-app/assets/layout.js');
    expect(result.css['app/layout.tsx']).toEqual(['/my-app/assets/layout.css']);
  });

  it('collects transitive modulepreload dependencies', () => {
    const entryChunk = mockChunk({
      fileName: 'assets/layout-abc.js',
      facadeModuleId: '/project/app/layout.tsx',
      imports: ['assets/vendor-xyz.js'],
    });

    const vendorChunk = mockChunk({
      fileName: 'assets/vendor-xyz.js',
      imports: ['assets/react-123.js'],
    });

    const reactChunk = mockChunk({
      fileName: 'assets/react-123.js',
      imports: [],
    });

    const bundle: MockBundle = {
      'assets/layout-abc.js': entryChunk,
      'assets/vendor-xyz.js': vendorChunk,
      'assets/react-123.js': reactChunk,
    };

    const result = buildManifestFromBundle(bundle, '/', '/project');
    expect(result.modulepreload['app/layout.tsx']).toEqual([
      '/assets/vendor-xyz.js',
      '/assets/react-123.js',
    ]);
  });

  it('skips chunks without facadeModuleId', () => {
    const bundle: MockBundle = {
      'assets/shared-chunk.js': mockChunk({
        fileName: 'assets/shared-chunk.js',
        facadeModuleId: null,
      }),
    };

    const result = buildManifestFromBundle(bundle, '/', '/project');
    expect(Object.keys(result.js)).toHaveLength(0);
  });

  it('collects all CSS assets under _global key', () => {
    const bundle: MockBundle = {
      'assets/layout-abc.css': mockAsset('assets/layout-abc.css'),
      'assets/page-def.css': mockAsset('assets/page-def.css'),
      'assets/chunk.js': mockChunk({ fileName: 'assets/chunk.js' }),
    };

    const result = buildManifestFromBundle(bundle, '/', '/project');
    expect(result.css['_global']).toEqual(['/assets/layout-abc.css', '/assets/page-def.css']);
  });

  it('returns empty manifest for empty bundle', () => {
    const result = buildManifestFromBundle({}, '/', '/project');
    expect(result).toEqual({ css: {}, js: {}, modulepreload: {}, fonts: {} });
  });

  it('tracks vendor chunks in modulepreload dependencies', () => {
    const pageChunk = mockChunk({
      fileName: 'assets/page-abc.js',
      facadeModuleId: '/project/app/page.tsx',
      imports: ['assets/vendor-timber-xyz.js'],
    });

    const timberChunk = mockChunk({
      fileName: 'assets/vendor-timber-xyz.js',
      imports: ['assets/vendor-react-123.js'],
    });

    const reactChunk = mockChunk({
      fileName: 'assets/vendor-react-123.js',
      imports: [],
    });

    const bundle: MockBundle = {
      'assets/page-abc.js': pageChunk,
      'assets/vendor-timber-xyz.js': timberChunk,
      'assets/vendor-react-123.js': reactChunk,
    };

    const result = buildManifestFromBundle(bundle, '/', '/project');
    // Both vendor chunks should appear as modulepreload deps
    expect(result.modulepreload['app/page.tsx']).toEqual([
      '/assets/vendor-timber-xyz.js',
      '/assets/vendor-react-123.js',
    ]);
  });

  it('handles circular imports without infinite loop', () => {
    const chunkA = mockChunk({
      fileName: 'assets/a.js',
      facadeModuleId: '/project/app/a.tsx',
      imports: ['assets/b.js'],
    });

    const chunkB = mockChunk({
      fileName: 'assets/b.js',
      imports: ['assets/a.js'], // circular
    });

    const bundle: MockBundle = {
      'assets/a.js': chunkA,
      'assets/b.js': chunkB,
    };

    const result = buildManifestFromBundle(bundle, '/', '/project');
    // Should not throw, and should list b.js as a dep of a
    expect(result.modulepreload['app/a.tsx']).toEqual(['/assets/b.js', '/assets/a.js']);
  });
});
