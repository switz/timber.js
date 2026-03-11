/**
 * Tests for the local font support in timber-fonts.
 *
 * Covers:
 * - Single src string resolution
 * - Multi-weight src array resolution
 * - Font file path resolution relative to importer
 * - next/font/local shim resolution
 * - FontResult shape consistency with Google font output
 * - @font-face descriptor generation
 * - Local font config extraction from source
 *
 * Design doc: 24-fonts.md
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inferFontFormat,
  normalizeSrc,
  resolveLocalFontPaths,
  generateFamilyName,
  generateLocalFontFaces,
  localFontClassName,
  processLocalFont,
  extractLocalFontConfig,
} from '../packages/timber-app/src/fonts/local.js';
import { timberFonts, parseLocalFontImportName } from '../packages/timber-app/src/plugins/fonts.js';
import type { PluginContext } from '../packages/timber-app/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

function createPluginContext(): PluginContext {
  return {
    config: { output: 'server' },
    routeTree: null,
    appDir: resolve(PROJECT_ROOT, 'app'),
    root: PROJECT_ROOT,
    dev: false,
    buildManifest: null,
  };
}

// ─── Single src string ────────────────────────────────────────────────────────

describe('handles single src string', () => {
  it('normalizes string src to single-entry array', () => {
    const sources = normalizeSrc('./fonts/MyFont.woff2');
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBe('./fonts/MyFont.woff2');
    expect(sources[0].weight).toBe('400');
    expect(sources[0].style).toBe('normal');
  });

  it('extracts config with single string src', () => {
    const config = extractLocalFontConfig("({ src: './fonts/MyFont.woff2', display: 'swap' })");
    expect(config).not.toBeNull();
    expect(config!.src).toBe('./fonts/MyFont.woff2');
    expect(config!.display).toBe('swap');
  });

  it('processes single src into ExtractedFont', () => {
    const extracted = processLocalFont(
      { src: './fonts/MyFont.woff2', display: 'swap' },
      '/project/app/layout.tsx'
    );
    expect(extracted.provider).toBe('local');
    expect(extracted.family).toBe('MyFont');
    expect(extracted.weights).toEqual(['400']);
    expect(extracted.styles).toEqual(['normal']);
    expect(extracted.localSources).toHaveLength(1);
    expect(extracted.localSources![0].path).toBe(resolve('/project/app', 'fonts/MyFont.woff2'));
  });

  it('generates @font-face for single src', () => {
    const descriptors = generateLocalFontFaces(
      'MyFont',
      [{ path: '/abs/fonts/MyFont.woff2', weight: '400', style: 'normal' }],
      'swap'
    );
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].family).toBe('MyFont');
    expect(descriptors[0].src).toContain("url('/abs/fonts/MyFont.woff2')");
    expect(descriptors[0].src).toContain("format('woff2')");
    expect(descriptors[0].weight).toBe('400');
    expect(descriptors[0].display).toBe('swap');
  });
});

// ─── Multi-weight src array ──────────────────────────────────────────────────

describe('handles multi-weight src array', () => {
  it('normalizes src array with explicit weights', () => {
    const sources = normalizeSrc([
      { path: './fonts/Regular.woff2', weight: '400' },
      { path: './fonts/Bold.woff2', weight: '700' },
    ]);
    expect(sources).toHaveLength(2);
    expect(sources[0].weight).toBe('400');
    expect(sources[1].weight).toBe('700');
  });

  it('defaults missing weight and style', () => {
    const sources = normalizeSrc([{ path: './fonts/Font.woff2' }]);
    expect(sources[0].weight).toBe('400');
    expect(sources[0].style).toBe('normal');
  });

  it('extracts multi-weight src array from source', () => {
    const config = extractLocalFontConfig(
      "({ src: [{ path: './fonts/Regular.woff2', weight: '400' }, { path: './fonts/Bold.woff2', weight: '700' }], variable: '--font-custom' })"
    );
    expect(config).not.toBeNull();
    expect(Array.isArray(config!.src)).toBe(true);
    const srcArray = config!.src as Array<{ path: string; weight?: string }>;
    expect(srcArray).toHaveLength(2);
    expect(srcArray[0].path).toBe('./fonts/Regular.woff2');
    expect(srcArray[0].weight).toBe('400');
    expect(srcArray[1].path).toBe('./fonts/Bold.woff2');
    expect(srcArray[1].weight).toBe('700');
    expect(config!.variable).toBe('--font-custom');
  });

  it('generates multiple @font-face rules for multi-weight', () => {
    const descriptors = generateLocalFontFaces(
      'MyFont',
      [
        { path: '/abs/fonts/Regular.woff2', weight: '400', style: 'normal' },
        { path: '/abs/fonts/Bold.woff2', weight: '700', style: 'normal' },
        { path: '/abs/fonts/Italic.woff2', weight: '400', style: 'italic' },
      ],
      'swap'
    );
    expect(descriptors).toHaveLength(3);
    expect(descriptors[0].weight).toBe('400');
    expect(descriptors[1].weight).toBe('700');
    expect(descriptors[2].style).toBe('italic');
  });

  it('processes multi-weight src into ExtractedFont with deduped weights', () => {
    const extracted = processLocalFont(
      {
        src: [
          { path: './fonts/Regular.woff2', weight: '400' },
          { path: './fonts/Bold.woff2', weight: '700' },
          { path: './fonts/BoldItalic.woff2', weight: '700', style: 'italic' },
        ],
      },
      '/project/app/layout.tsx'
    );
    expect(extracted.weights).toEqual(['400', '700']);
    expect(extracted.styles).toEqual(['normal', 'italic']);
    expect(extracted.localSources).toHaveLength(3);
  });
});

// ─── Path resolution ─────────────────────────────────────────────────────────

describe('resolves paths relative to importer', () => {
  it('resolves relative paths from importer directory', () => {
    const resolved = resolveLocalFontPaths('/project/app/layout.tsx', [
      { path: './fonts/MyFont.woff2', weight: '400', style: 'normal' },
    ]);
    expect(resolved[0].path).toBe(resolve('/project/app', 'fonts/MyFont.woff2'));
  });

  it('resolves parent-relative paths', () => {
    const resolved = resolveLocalFontPaths('/project/app/components/Header.tsx', [
      { path: '../fonts/MyFont.woff2', weight: '400', style: 'normal' },
    ]);
    expect(resolved[0].path).toBe(resolve('/project/app', 'fonts/MyFont.woff2'));
  });

  it('preserves weight and style during resolution', () => {
    const resolved = resolveLocalFontPaths('/project/app/layout.tsx', [
      { path: './fonts/Bold.woff2', weight: '700', style: 'normal' },
    ]);
    expect(resolved[0].weight).toBe('700');
    expect(resolved[0].style).toBe('normal');
  });
});

// ─── next/font/local shim resolution ─────────────────────────────────────────

describe('next/font/local shim resolves', () => {
  it('plugin resolves @timber/fonts/local to virtual module', () => {
    const plugin = timberFonts(createPluginContext());
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId.call({}, '@timber/fonts/local')).toBe('\0@timber/fonts/local');
  });

  it('plugin loads virtual module source for @timber/fonts/local', () => {
    const plugin = timberFonts(createPluginContext());
    const load = plugin.load as (id: string) => string | null;
    const result = load.call({}, '\0@timber/fonts/local');
    expect(result).not.toBeNull();
    expect(result).toContain('localFont');
    expect(result).toContain('export default');
  });
});

// ─── FontResult shape consistency ────────────────────────────────────────────

describe('returns consistent FontResult', () => {
  it('local font returns className, style.fontFamily, and variable', () => {
    const extracted = processLocalFont(
      {
        src: './fonts/MyFont.woff2',
        display: 'swap',
        variable: '--font-custom',
      },
      '/project/app/layout.tsx'
    );
    expect(extracted.className).toMatch(/^timber-font-/);
    expect(extracted.fontFamily).toContain("'MyFont'");
    expect(extracted.variable).toBe('--font-custom');
  });

  it('local font without variable omits it', () => {
    const extracted = processLocalFont({ src: './fonts/MyFont.woff2' }, '/project/app/layout.tsx');
    expect(extracted.variable).toBeUndefined();
  });

  it('FontResult shape matches google font output', () => {
    const localExtracted = processLocalFont(
      {
        src: './fonts/MyFont.woff2',
        variable: '--font-custom',
        family: 'MyFont',
      },
      '/project/app/layout.tsx'
    );

    // Same fields as Google font ExtractedFont
    expect(localExtracted).toHaveProperty('id');
    expect(localExtracted).toHaveProperty('family');
    expect(localExtracted).toHaveProperty('provider');
    expect(localExtracted).toHaveProperty('weights');
    expect(localExtracted).toHaveProperty('styles');
    expect(localExtracted).toHaveProperty('display');
    expect(localExtracted).toHaveProperty('className');
    expect(localExtracted).toHaveProperty('fontFamily');
    expect(localExtracted).toHaveProperty('variable');
    expect(localExtracted).toHaveProperty('importer');
    expect(localExtracted.provider).toBe('local');
  });
});

// ─── Plugin transform for local fonts ────────────────────────────────────────

describe('plugin transforms local font calls', () => {
  it('transforms localFont() call to static object', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;

    const source = `
import localFont from '@timber/fonts/local'
const myFont = localFont({ src: './fonts/MyFont.woff2', display: 'swap', variable: '--font-custom' })
export default function Layout() { return null }
`;

    const result = transform.call({ error: () => {} }, source, '/app/layout.tsx');
    expect(result).not.toBeNull();
    expect(result!.code).not.toContain("from '@timber/fonts/local'");
    expect(result!.code).not.toContain('localFont(');
    expect(result!.code).toContain('timber-font-');
    expect(result!.code).toContain('"--font-custom"');
  });

  it('transforms localFont() with multi-weight src array', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;

    const source = `
import localFont from '@timber/fonts/local'
const myFont = localFont({ src: [{ path: './fonts/Regular.woff2', weight: '400' }, { path: './fonts/Bold.woff2', weight: '700' }], display: 'swap' })
`;

    const result = transform.call({ error: () => {} }, source, '/app/layout.tsx');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('className:');
    expect(result!.code).toContain('fontFamily:');
  });

  it('skips files without @timber/fonts/local imports', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => null;

    const result = transform.call(
      { error: () => {} },
      "import React from 'react'",
      '/app/page.tsx'
    );
    expect(result).toBeNull();
  });

  it('transforms local font with custom family name', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;

    const source = `
import localFont from '@timber/fonts/local'
const heading = localFont({ src: './fonts/Heading.woff2', family: 'Brand Heading', variable: '--font-heading' })
`;

    const result = transform.call({ error: () => {} }, source, '/app/layout.tsx');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('timber-font-brand-heading');
    expect(result!.code).toContain('"--font-heading"');
  });
});

// ─── Import parsing ──────────────────────────────────────────────────────────

describe('parses local font imports', () => {
  it('parses default import name', () => {
    const name = parseLocalFontImportName("import localFont from '@timber/fonts/local'");
    expect(name).toBe('localFont');
  });

  it('parses custom import name', () => {
    const name = parseLocalFontImportName("import myLoader from '@timber/fonts/local'");
    expect(name).toBe('myLoader');
  });

  it('returns null for unrelated imports', () => {
    const name = parseLocalFontImportName("import React from 'react'");
    expect(name).toBeNull();
  });
});

// ─── Font format inference ───────────────────────────────────────────────────

describe('infers font format from extension', () => {
  it('detects woff2', () => expect(inferFontFormat('font.woff2')).toBe('woff2'));
  it('detects woff', () => expect(inferFontFormat('font.woff')).toBe('woff'));
  it('detects ttf', () => expect(inferFontFormat('font.ttf')).toBe('truetype'));
  it('detects otf', () => expect(inferFontFormat('font.otf')).toBe('opentype'));
  it('defaults unknown to woff2', () => expect(inferFontFormat('font.xyz')).toBe('woff2'));
});

// ─── Family name generation ──────────────────────────────────────────────────

describe('generates family name from file path', () => {
  it('extracts family from filename', () => {
    const name = generateFamilyName([{ path: './fonts/MyFont-Regular.woff2', weight: '400' }]);
    expect(name).toBe('MyFont');
  });

  it('handles filename without weight suffix', () => {
    const name = generateFamilyName([{ path: './fonts/CustomDisplay.woff2', weight: '400' }]);
    expect(name).toBe('CustomDisplay');
  });

  it('returns fallback for empty sources', () => {
    const name = generateFamilyName([]);
    expect(name).toBe('Local Font');
  });
});

// ─── Class name generation ───────────────────────────────────────────────────

describe('generates className', () => {
  it('generates lowercase hyphenated class', () => {
    expect(localFontClassName('Brand Heading')).toBe('timber-font-brand-heading');
  });

  it('handles single word', () => {
    expect(localFontClassName('Custom')).toBe('timber-font-custom');
  });
});

// ─── Config extraction edge cases ────────────────────────────────────────────

describe('extracts local font config edge cases', () => {
  it('extracts family override', () => {
    const config = extractLocalFontConfig(
      "({ src: './fonts/Font.woff2', family: 'My Custom Font' })"
    );
    expect(config).not.toBeNull();
    expect(config!.family).toBe('My Custom Font');
  });

  it('returns null for missing src', () => {
    const config = extractLocalFontConfig("({ display: 'swap' })");
    expect(config).toBeNull();
  });

  it('returns null for non-object argument', () => {
    const config = extractLocalFontConfig('(someVariable)');
    expect(config).toBeNull();
  });

  it('extracts style from src array entries', () => {
    const config = extractLocalFontConfig(
      "({ src: [{ path: './a.woff2', weight: '400', style: 'italic' }] })"
    );
    expect(config).not.toBeNull();
    const srcArray = config!.src as Array<{ path: string; style?: string }>;
    expect(srcArray[0].style).toBe('italic');
  });

  it('handles comments in local font config', () => {
    const config = extractLocalFontConfig(`({
      src: './fonts/MyFont.woff2', // the font file
      display: 'swap', // fast swap
      variable: '--font-custom', // CSS variable
    })`);
    expect(config).not.toBeNull();
    expect(config!.src).toBe('./fonts/MyFont.woff2');
    expect(config!.display).toBe('swap');
    expect(config!.variable).toBe('--font-custom');
  });

  it('handles trailing commas in local font src array', () => {
    const config = extractLocalFontConfig(`({
      src: [
        { path: './fonts/Regular.woff2', weight: '400', },
        { path: './fonts/Bold.woff2', weight: '700', },
      ],
      display: 'swap',
    })`);
    expect(config).not.toBeNull();
    const srcArray = config!.src as Array<{ path: string; weight?: string }>;
    expect(srcArray).toHaveLength(2);
    expect(srcArray[0].path).toBe('./fonts/Regular.woff2');
    expect(srcArray[1].weight).toBe('700');
  });

  it('handles multi-line local font config with block comments', () => {
    const config = extractLocalFontConfig(`({
      src: [
        /* Regular weight */
        {
          path: './fonts/Regular.woff2',
          weight: '400',
        },
        /* Bold weight */
        {
          path: './fonts/Bold.woff2',
          weight: '700',
        },
      ],
      family: 'Custom Font',
      variable: '--font-custom',
    })`);
    expect(config).not.toBeNull();
    expect(config!.family).toBe('Custom Font');
    const srcArray = config!.src as Array<{ path: string; weight?: string }>;
    expect(srcArray).toHaveLength(2);
    expect(srcArray[0].path).toBe('./fonts/Regular.woff2');
    expect(srcArray[1].path).toBe('./fonts/Bold.woff2');
  });
});
