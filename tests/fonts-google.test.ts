/**
 * Tests for Google Fonts download, caching, and dev CDN fallback.
 *
 * Covers:
 * - Google Fonts CSS API URL construction
 * - CSS response parsing
 * - Subset filtering
 * - Content-hashed filename generation
 * - Font file caching (hit and miss)
 * - Dev mode CDN URL generation
 * - Production build font file emission
 *
 * Design doc: 24-fonts.md §"Step 2: Font Download & Subsetting"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildGoogleFontsUrl,
  parseGoogleFontsCss,
  filterBySubsets,
  contentHash,
  hashedFontFilename,
  cacheKey,
  downloadAndCacheFonts,
  generateProductionFontFaces,
  generateDevFontFaces,
  type GoogleFontFace,
} from '../packages/timber-app/src/fonts/google.js';
import type { ExtractedFont } from '../packages/timber-app/src/fonts/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExtractedFont(overrides: Partial<ExtractedFont> = {}): ExtractedFont {
  return {
    id: 'inter-400-normal-latin',
    family: 'Inter',
    provider: 'google',
    weights: ['400'],
    styles: ['normal'],
    subsets: ['latin'],
    display: 'swap',
    className: 'timber-font-inter',
    fontFamily: "'Inter', 'Inter Fallback', system-ui, sans-serif",
    importer: '/app/layout.tsx',
    ...overrides,
  };
}

function makeFontFace(overrides: Partial<GoogleFontFace> = {}): GoogleFontFace {
  return {
    family: 'Inter',
    weight: '400',
    style: 'normal',
    url: 'https://fonts.gstatic.com/s/inter/v13/abc123.woff2',
    unicodeRange: 'U+0000-00FF, U+0131',
    subset: 'latin',
    ...overrides,
  };
}

/** Sample CSS response from Google Fonts API. */
const SAMPLE_CSS = `
/* latin-ext */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v13/latinext.woff2) format('woff2');
  unicode-range: U+0100-02AF, U+0304;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v13/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153;
}
/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v13/cyrillic.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
`;

// ─── Google Fonts API URL ─────────────────────────────────────────────────────

describe('builds correct Google Fonts API URL', () => {
  it('builds URL for single weight', () => {
    const font = makeExtractedFont({ weights: ['400'] });
    const url = buildGoogleFontsUrl(font);
    expect(url).toContain('fonts.googleapis.com/css2');
    expect(url).toContain('family=Inter');
    expect(url).toContain('wght@400');
    expect(url).toContain('display=swap');
  });

  it('builds URL for multiple weights', () => {
    const font = makeExtractedFont({ weights: ['400', '700'] });
    const url = buildGoogleFontsUrl(font);
    expect(url).toContain('wght@400;700');
  });

  it('builds URL with italic axis', () => {
    const font = makeExtractedFont({
      weights: ['400'],
      styles: ['normal', 'italic'],
    });
    const url = buildGoogleFontsUrl(font);
    expect(url).toContain('ital,wght');
    expect(url).toContain('0,400');
    expect(url).toContain('1,400');
  });

  it('builds URL for multi-word font family', () => {
    const font = makeExtractedFont({ family: 'JetBrains Mono' });
    const url = buildGoogleFontsUrl(font);
    expect(url).toContain('family=JetBrains+Mono');
  });

  it('sorts weights numerically', () => {
    const font = makeExtractedFont({ weights: ['700', '400', '300'] });
    const url = buildGoogleFontsUrl(font);
    expect(url).toContain('wght@300;400;700');
  });
});

// ─── CSS Parsing ──────────────────────────────────────────────────────────────

describe('parses Google Fonts CSS response', () => {
  it('parses all @font-face blocks', () => {
    const faces = parseGoogleFontsCss(SAMPLE_CSS);
    expect(faces).toHaveLength(3);
  });

  it('extracts family, weight, style from blocks', () => {
    const faces = parseGoogleFontsCss(SAMPLE_CSS);
    expect(faces[0].family).toBe('Inter');
    expect(faces[0].weight).toBe('400');
    expect(faces[0].style).toBe('normal');
  });

  it('extracts font URLs', () => {
    const faces = parseGoogleFontsCss(SAMPLE_CSS);
    expect(faces[0].url).toBe('https://fonts.gstatic.com/s/inter/v13/latinext.woff2');
    expect(faces[1].url).toBe('https://fonts.gstatic.com/s/inter/v13/latin.woff2');
  });

  it('extracts unicode-range', () => {
    const faces = parseGoogleFontsCss(SAMPLE_CSS);
    expect(faces[1].unicodeRange).toContain('U+0000-00FF');
  });

  it('extracts subset labels from comments', () => {
    const faces = parseGoogleFontsCss(SAMPLE_CSS);
    expect(faces[0].subset).toBe('latin-ext');
    expect(faces[1].subset).toBe('latin');
    expect(faces[2].subset).toBe('cyrillic');
  });

  it('handles empty CSS', () => {
    const faces = parseGoogleFontsCss('');
    expect(faces).toHaveLength(0);
  });

  it('handles CSS with no @font-face blocks', () => {
    const faces = parseGoogleFontsCss('body { font-family: Arial; }');
    expect(faces).toHaveLength(0);
  });
});

// ─── Subset filtering ─────────────────────────────────────────────────────────

describe('filters faces by subset', () => {
  it('filters to requested subsets', () => {
    const faces = parseGoogleFontsCss(SAMPLE_CSS);
    const filtered = filterBySubsets(faces, ['latin']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].subset).toBe('latin');
  });

  it('filters to multiple subsets', () => {
    const faces = parseGoogleFontsCss(SAMPLE_CSS);
    const filtered = filterBySubsets(faces, ['latin', 'cyrillic']);
    expect(filtered).toHaveLength(2);
  });

  it('returns all faces when subsets array is empty', () => {
    const faces = parseGoogleFontsCss(SAMPLE_CSS);
    const filtered = filterBySubsets(faces, []);
    expect(filtered).toHaveLength(3);
  });
});

// ─── Content hashing ──────────────────────────────────────────────────────────

describe('generates content-hashed filename', () => {
  it('generates deterministic hash for same content', () => {
    const data = Buffer.from('font-data');
    const hash1 = contentHash(data);
    const hash2 = contentHash(data);
    expect(hash1).toBe(hash2);
  });

  it('generates different hash for different content', () => {
    const hash1 = contentHash(Buffer.from('font-a'));
    const hash2 = contentHash(Buffer.from('font-b'));
    expect(hash1).not.toBe(hash2);
  });

  it('hash is 8 characters', () => {
    const hash = contentHash(Buffer.from('font-data'));
    expect(hash).toHaveLength(8);
  });

  it('generates correct filename format', () => {
    const face = makeFontFace({ family: 'Inter', subset: 'latin', weight: '400', style: 'normal' });
    const data = Buffer.from('font-data');
    const filename = hashedFontFilename(face, data);
    expect(filename).toMatch(/^inter-latin-400-normal-[a-f0-9]{8}\.woff2$/);
  });

  it('handles multi-word family names', () => {
    const face = makeFontFace({
      family: 'JetBrains Mono',
      subset: 'latin',
      weight: '400',
      style: 'normal',
    });
    const data = Buffer.from('font-data');
    const filename = hashedFontFilename(face, data);
    expect(filename).toMatch(/^jetbrains-mono-latin-400-normal-[a-f0-9]{8}\.woff2$/);
  });
});

// ─── Cache key ────────────────────────────────────────────────────────────────

describe('cache key generation', () => {
  it('generates deterministic cache key', () => {
    const face = makeFontFace();
    expect(cacheKey(face)).toBe('inter-latin-400-normal');
  });

  it('different weights produce different keys', () => {
    const face400 = makeFontFace({ weight: '400' });
    const face700 = makeFontFace({ weight: '700' });
    expect(cacheKey(face400)).not.toBe(cacheKey(face700));
  });
});

// ─── Download and cache ───────────────────────────────────────────────────────

describe('caches downloaded fonts', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'timber-fonts-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('downloads and caches font files', async () => {
    const fakeData = Buffer.from('fake-woff2-data');

    // Mock fetch to return our sample CSS and fake font data
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('fonts.googleapis.com')) {
        return new Response(SAMPLE_CSS, { status: 200 });
      }
      // Font file download
      return new Response(fakeData, { status: 200 });
    }) as typeof fetch;

    try {
      const font = makeExtractedFont({ subsets: ['latin'] });
      const cached = await downloadAndCacheFonts([font], tempDir);

      expect(cached).toHaveLength(1);
      expect(cached[0].hashedFilename).toMatch(/^inter-latin-400-normal-[a-f0-9]{8}\.woff2$/);
      expect(cached[0].data).toEqual(fakeData);

      // Verify cache files exist
      const cacheDir = join(tempDir, 'node_modules/.cache/timber-fonts');
      const metaContent = await readFile(
        join(cacheDir, 'inter-latin-400-normal.meta.json'),
        'utf-8'
      );
      const meta = JSON.parse(metaContent);
      expect(meta.hashedFilename).toBe(cached[0].hashedFilename);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('skips download when cache hit', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'timber-fonts-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reuses cached fonts on subsequent builds', async () => {
    const fakeData = Buffer.from('cached-font-data');
    const filename = hashedFontFilename(makeFontFace({ subset: 'latin' }), fakeData);

    // Pre-populate cache
    const cacheDir = join(tempDir, 'node_modules/.cache/timber-fonts');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'inter-latin-400-normal.woff2'), fakeData);
    await writeFile(
      join(cacheDir, 'inter-latin-400-normal.meta.json'),
      JSON.stringify({ hashedFilename: filename, url: 'https://example.com' })
    );

    let fetchCallCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      fetchCallCount++;
      if (urlStr.includes('fonts.googleapis.com')) {
        return new Response(SAMPLE_CSS, { status: 200 });
      }
      return new Response(Buffer.from('should-not-reach'), { status: 200 });
    }) as typeof fetch;

    try {
      const font = makeExtractedFont({ subsets: ['latin'] });
      const cached = await downloadAndCacheFonts([font], tempDir);

      expect(cached).toHaveLength(1);
      expect(cached[0].hashedFilename).toBe(filename);
      expect(cached[0].data).toEqual(fakeData);
      // Only the CSS API should be fetched, not the font file
      expect(fetchCallCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Dev mode CDN URLs ────────────────────────────────────────────────────────

describe('uses CDN URLs in dev mode', () => {
  it('generates @font-face with CDN URLs', () => {
    const faces = [
      makeFontFace({
        url: 'https://fonts.gstatic.com/s/inter/v13/latin.woff2',
        unicodeRange: 'U+0000-00FF',
      }),
    ];

    const descriptors = generateDevFontFaces(faces, 'swap');
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].src).toContain('fonts.gstatic.com');
    expect(descriptors[0].family).toBe('Inter');
    expect(descriptors[0].display).toBe('swap');
    expect(descriptors[0].unicodeRange).toBe('U+0000-00FF');
  });

  it('preserves all face metadata in dev mode', () => {
    const faces = [makeFontFace({ weight: '700', style: 'italic' })];

    const descriptors = generateDevFontFaces(faces, 'swap');
    expect(descriptors[0].weight).toBe('700');
    expect(descriptors[0].style).toBe('italic');
  });
});

// ─── Production font faces ────────────────────────────────────────────────────

describe('emits font files in build output', () => {
  it('generates production @font-face with hashed URLs', () => {
    const cachedFonts = [
      {
        face: makeFontFace({
          unicodeRange: 'U+0000-00FF',
        }),
        hashedFilename: 'inter-latin-400-normal-abc12345.woff2',
        cachePath: '/cache/inter.woff2',
        data: Buffer.from('data'),
      },
    ];

    const descriptors = generateProductionFontFaces(cachedFonts, 'swap');
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].src).toContain('/_timber/fonts/inter-latin-400-normal-abc12345.woff2');
    expect(descriptors[0].src).toContain("format('woff2')");
    expect(descriptors[0].family).toBe('Inter');
    expect(descriptors[0].weight).toBe('400');
    expect(descriptors[0].style).toBe('normal');
    expect(descriptors[0].display).toBe('swap');
    expect(descriptors[0].unicodeRange).toBe('U+0000-00FF');
  });

  it('generates entries for multiple cached fonts', () => {
    const cachedFonts = [
      {
        face: makeFontFace({ weight: '400' }),
        hashedFilename: 'inter-latin-400-normal-aaa.woff2',
        cachePath: '/cache/a.woff2',
        data: Buffer.from('a'),
      },
      {
        face: makeFontFace({ weight: '700' }),
        hashedFilename: 'inter-latin-700-normal-bbb.woff2',
        cachePath: '/cache/b.woff2',
        data: Buffer.from('b'),
      },
    ];

    const descriptors = generateProductionFontFaces(cachedFonts, 'swap');
    expect(descriptors).toHaveLength(2);
    expect(descriptors[0].weight).toBe('400');
    expect(descriptors[1].weight).toBe('700');
  });
});
