/**
 * Tests for font build manifest + Early Hints integration.
 *
 * Covers:
 * - Build manifest includes font entries per segment
 * - 103 Early Hints include font preload headers for matched route
 * - HTML head includes font preload link tags
 * - Only fonts used by matched segments are hinted
 * - Font plugin generateBundle emits metadata to manifest
 *
 * Design docs: 24-fonts.md, 02-rendering-pipeline.md §"Early Hints"
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectRouteFonts,
  buildFontPreloadTags,
  buildFontLinkHeaders,
} from '../packages/timber-app/src/server/build-manifest.js';
import type { BuildManifest, ManifestFontEntry } from '../packages/timber-app/src/server/build-manifest.js';
import { timberFonts } from '../packages/timber-app/src/plugins/fonts.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

function createPluginContext(overrides?: Partial<PluginContext>): PluginContext {
  return {
    config: { output: 'server' },
    routeTree: null,
    appDir: resolve(PROJECT_ROOT, 'app'),
    root: PROJECT_ROOT,
    dev: false,
    buildManifest: null,
    ...overrides,
  };
}

function createManifest(fonts: Record<string, ManifestFontEntry[]>): BuildManifest {
  return { css: {}, js: {}, modulepreload: {}, fonts };
}

// ─── Manifest contains font metadata ─────────────────────────────────────────

describe('manifest contains font metadata', () => {
  it('generateBundle writes font entries to buildManifest', () => {
    const buildManifest: BuildManifest = createManifest({});
    const ctx = createPluginContext({ buildManifest, root: '/project' });
    const plugin = timberFonts(ctx);

    // Simulate transform to register fonts in the registry
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
    const source = `
import { Inter } from '@timber/fonts/google'
const inter = Inter({ subsets: ['latin'], weight: '400', display: 'swap' })
`;
    transform.call({ error: () => {} }, source, '/project/app/layout.tsx');

    // Run generateBundle
    const generateBundle = plugin.generateBundle as () => void;
    generateBundle.call({});

    // Font entries should be written to the manifest keyed by relative path
    expect(buildManifest.fonts['app/layout.tsx']).toBeDefined();
    expect(buildManifest.fonts['app/layout.tsx'].length).toBeGreaterThan(0);

    const entry = buildManifest.fonts['app/layout.tsx'][0];
    expect(entry.href).toContain('/_timber/fonts/inter-latin-400-normal.woff2');
    expect(entry.format).toBe('woff2');
    expect(entry.crossOrigin).toBe('anonymous');
  });

  it('generates entries for each weight × style × subset combination', () => {
    const buildManifest: BuildManifest = createManifest({});
    const ctx = createPluginContext({ buildManifest, root: '/project' });
    const plugin = timberFonts(ctx);

    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
    const source = `
import { Inter } from '@timber/fonts/google'
const inter = Inter({ subsets: ['latin', 'cyrillic'], weight: ['400', '700'], display: 'swap' })
`;
    transform.call({ error: () => {} }, source, '/project/app/layout.tsx');

    const generateBundle = plugin.generateBundle as () => void;
    generateBundle.call({});

    const entries = buildManifest.fonts['app/layout.tsx'];
    // 2 subsets × 2 weights × 1 style = 4 entries
    expect(entries.length).toBe(4);
    expect(entries.map((e) => e.href)).toContain('/_timber/fonts/inter-latin-400-normal.woff2');
    expect(entries.map((e) => e.href)).toContain('/_timber/fonts/inter-cyrillic-700-normal.woff2');
  });

  it('does not write fonts when buildManifest is null (dev mode)', () => {
    const ctx = createPluginContext({ buildManifest: null, root: '/project' });
    const plugin = timberFonts(ctx);

    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
    const source = `
import { Inter } from '@timber/fonts/google'
const inter = Inter({ subsets: ['latin'], weight: '400', display: 'swap' })
`;
    transform.call({ error: () => {} }, source, '/project/app/layout.tsx');

    // Should not throw
    const generateBundle = plugin.generateBundle as () => void;
    generateBundle.call({});

    // buildManifest remains null
    expect(ctx.buildManifest).toBeNull();
  });
});

// ─── collectRouteFonts ───────────────────────────────────────────────────────

describe('collectRouteFonts', () => {
  it('collects fonts from matched segments', () => {
    const fonts: ManifestFontEntry[] = [
      { href: '/_timber/fonts/inter-latin-400-normal.woff2', format: 'woff2', crossOrigin: 'anonymous' },
    ];
    const manifest = createManifest({ 'app/layout.tsx': fonts });
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];

    const result = collectRouteFonts(segments, manifest);
    expect(result).toEqual(fonts);
  });

  it('deduplicates fonts by href across segments', () => {
    const font: ManifestFontEntry = {
      href: '/_timber/fonts/inter-latin-400-normal.woff2',
      format: 'woff2',
      crossOrigin: 'anonymous',
    };
    const manifest = createManifest({
      'app/layout.tsx': [font],
      'app/page.tsx': [font], // same font referenced by both
    });
    const segments = [
      { layout: { filePath: 'app/layout.tsx' }, page: { filePath: 'app/page.tsx' } },
    ];

    const result = collectRouteFonts(segments, manifest);
    expect(result.length).toBe(1);
  });

  it('collects fonts from multiple segments in order', () => {
    const rootFont: ManifestFontEntry = {
      href: '/_timber/fonts/inter-latin-400-normal.woff2',
      format: 'woff2',
      crossOrigin: 'anonymous',
    };
    const pageFont: ManifestFontEntry = {
      href: '/_timber/fonts/jetbrains-mono-latin-400-normal.woff2',
      format: 'woff2',
      crossOrigin: 'anonymous',
    };
    const manifest = createManifest({
      'app/layout.tsx': [rootFont],
      'app/blog/page.tsx': [pageFont],
    });
    const segments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { page: { filePath: 'app/blog/page.tsx' } },
    ];

    const result = collectRouteFonts(segments, manifest);
    expect(result).toEqual([rootFont, pageFont]);
  });

  it('returns empty array when no fonts in manifest', () => {
    const manifest = createManifest({});
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];

    const result = collectRouteFonts(segments, manifest);
    expect(result).toEqual([]);
  });
});

// ─── emits font Link headers in Early Hints ─────────────────────────────────

describe('emits font Link headers in Early Hints', () => {
  it('generates Link header with rel=preload as=font crossorigin', () => {
    const fonts: ManifestFontEntry[] = [
      { href: '/_timber/fonts/inter-latin-400-normal.woff2', format: 'woff2', crossOrigin: 'anonymous' },
    ];

    const header = buildFontLinkHeaders(fonts);
    expect(header).toBe('</_timber/fonts/inter-latin-400-normal.woff2>; rel=preload; as=font; crossorigin');
  });

  it('joins multiple font entries with comma separator', () => {
    const fonts: ManifestFontEntry[] = [
      { href: '/_timber/fonts/inter-latin-400-normal.woff2', format: 'woff2', crossOrigin: 'anonymous' },
      { href: '/_timber/fonts/mono-latin-400-normal.woff2', format: 'woff2', crossOrigin: 'anonymous' },
    ];

    const header = buildFontLinkHeaders(fonts);
    expect(header).toContain(', ');
    expect(header.split(', ').length).toBe(2);
  });

  it('returns empty string for no fonts', () => {
    expect(buildFontLinkHeaders([])).toBe('');
  });
});

// ─── renders font preload in head ────────────────────────────────────────────

describe('renders font preload in head', () => {
  it('generates <link rel="preload"> tags with correct attributes', () => {
    const fonts: ManifestFontEntry[] = [
      { href: '/_timber/fonts/inter-latin-400-normal.woff2', format: 'woff2', crossOrigin: 'anonymous' },
    ];

    const html = buildFontPreloadTags(fonts);
    expect(html).toContain('rel="preload"');
    expect(html).toContain('href="/_timber/fonts/inter-latin-400-normal.woff2"');
    expect(html).toContain('as="font"');
    expect(html).toContain('type="font/woff2"');
    expect(html).toContain('crossorigin="anonymous"');
  });

  it('generates multiple preload tags', () => {
    const fonts: ManifestFontEntry[] = [
      { href: '/_timber/fonts/inter-latin-400-normal.woff2', format: 'woff2', crossOrigin: 'anonymous' },
      { href: '/_timber/fonts/mono-latin-400-normal.woff2', format: 'woff2', crossOrigin: 'anonymous' },
    ];

    const html = buildFontPreloadTags(fonts);
    const links = html.match(/<link /g);
    expect(links?.length).toBe(2);
  });

  it('returns empty string for no fonts', () => {
    expect(buildFontPreloadTags([])).toBe('');
  });
});

// ─── does not hint unused fonts ──────────────────────────────────────────────

describe('does not hint unused fonts', () => {
  it('only collects fonts from matched segments, not all manifest entries', () => {
    const rootFont: ManifestFontEntry = {
      href: '/_timber/fonts/inter-latin-400-normal.woff2',
      format: 'woff2',
      crossOrigin: 'anonymous',
    };
    const otherFont: ManifestFontEntry = {
      href: '/_timber/fonts/playfair-latin-400-normal.woff2',
      format: 'woff2',
      crossOrigin: 'anonymous',
    };
    const manifest = createManifest({
      'app/layout.tsx': [rootFont],
      'app/other/page.tsx': [otherFont], // not in matched segments
    });

    // Only root layout is matched — other/page.tsx is a different route
    const segments = [{ layout: { filePath: 'app/layout.tsx' } }];
    const result = collectRouteFonts(segments, manifest);

    expect(result).toEqual([rootFont]);
    expect(result).not.toContainEqual(otherFont);
  });

  it('skips segments without font entries', () => {
    const font: ManifestFontEntry = {
      href: '/_timber/fonts/inter-latin-400-normal.woff2',
      format: 'woff2',
      crossOrigin: 'anonymous',
    };
    const manifest = createManifest({
      'app/layout.tsx': [font],
      // app/dashboard/layout.tsx has no fonts
    });

    const segments = [
      { layout: { filePath: 'app/layout.tsx' } },
      { layout: { filePath: 'app/dashboard/layout.tsx' } },
    ];
    const result = collectRouteFonts(segments, manifest);

    expect(result).toEqual([font]);
  });
});
