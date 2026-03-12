/**
 * Tests for the timber-fonts plugin.
 *
 * Covers:
 * - Static analysis of font function calls
 * - Dynamic call detection and error
 * - @font-face CSS generation
 * - Size-adjusted fallback generation
 * - FontResult shape (className, style.fontFamily, variable)
 * - CSS custom property class generation
 *
 * Design doc: 24-fonts.md
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractFontConfig,
  detectDynamicFontCall,
  parseGoogleFontImports,
  parseGoogleFontFamilies,
  generateAllFontCss,
  type FontRegistry,
} from '../packages/timber-app/src/plugins/fonts.js';
import {
  generateFontFace,
  generateFontFaces,
  generateVariableClass,
  generateFontFamilyClass,
} from '../packages/timber-app/src/fonts/css.js';
import {
  generateFallbackCss,
  hasFallbackMetrics,
  buildFontStack,
  getGenericFamily,
} from '../packages/timber-app/src/fonts/fallbacks.js';
import { timberFonts } from '../packages/timber-app/src/plugins/fonts.js';
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

// ─── Static analysis ─────────────────────────────────────────────────────────

describe('extracts font config from static calls', () => {
  it('extracts basic config with subsets and weight', () => {
    const config = extractFontConfig("({ subsets: ['latin'], weight: '400' })");
    expect(config).not.toBeNull();
    expect(config!.subsets).toEqual(['latin']);
    expect(config!.weight).toBe('400');
  });

  it('extracts display and variable', () => {
    const config = extractFontConfig(
      "({ subsets: ['latin'], display: 'swap', variable: '--font-sans' })"
    );
    expect(config).not.toBeNull();
    expect(config!.display).toBe('swap');
    expect(config!.variable).toBe('--font-sans');
  });

  it('extracts weight array', () => {
    const config = extractFontConfig("({ weight: ['400', '700'] })");
    expect(config).not.toBeNull();
    expect(config!.weight).toEqual(['400', '700']);
  });

  it('extracts style array', () => {
    const config = extractFontConfig("({ style: ['normal', 'italic'] })");
    expect(config).not.toBeNull();
    expect(config!.style).toEqual(['normal', 'italic']);
  });

  it('extracts style string', () => {
    const config = extractFontConfig("({ style: 'italic' })");
    expect(config).not.toBeNull();
    expect(config!.style).toBe('italic');
  });

  it('extracts multiple subsets', () => {
    const config = extractFontConfig("({ subsets: ['latin', 'latin-ext', 'cyrillic'] })");
    expect(config).not.toBeNull();
    expect(config!.subsets).toEqual(['latin', 'latin-ext', 'cyrillic']);
  });

  it('extracts preload boolean', () => {
    const config = extractFontConfig('({ preload: true })');
    expect(config).not.toBeNull();
    expect(config!.preload).toBe(true);
  });

  it('returns null for non-object argument', () => {
    const config = extractFontConfig('(someVariable)');
    expect(config).toBeNull();
  });
});

// ─── Edge cases: comments, trailing commas, multi-line ───────────────────────

describe('handles comments in config', () => {
  it('parses config with inline comments', () => {
    const config = extractFontConfig(`({
      subsets: ['latin'], // only latin for now
      weight: '400', // regular weight
      display: 'swap', // fast display
    })`);
    expect(config).not.toBeNull();
    expect(config!.subsets).toEqual(['latin']);
    expect(config!.weight).toBe('400');
    expect(config!.display).toBe('swap');
  });

  it('parses config with block comments', () => {
    const config = extractFontConfig(`({
      subsets: ['latin' /* primary */, 'cyrillic' /* secondary */],
      weight: '700',
      /* display option */
      display: 'swap',
    })`);
    expect(config).not.toBeNull();
    expect(config!.subsets).toEqual(['latin', 'cyrillic']);
    expect(config!.weight).toBe('700');
    expect(config!.display).toBe('swap');
  });
});

describe('handles trailing commas', () => {
  it('parses config with trailing commas in object', () => {
    const config = extractFontConfig(`({
      subsets: ['latin',],
      weight: '400',
      display: 'swap',
      variable: '--font-sans',
    })`);
    expect(config).not.toBeNull();
    expect(config!.subsets).toEqual(['latin']);
    expect(config!.weight).toBe('400');
    expect(config!.variable).toBe('--font-sans');
  });

  it('parses weight array with trailing comma', () => {
    const config = extractFontConfig(`({
      weight: ['400', '700',],
    })`);
    expect(config).not.toBeNull();
    expect(config!.weight).toEqual(['400', '700']);
  });
});

describe('handles multi-line config', () => {
  it('parses heavily multi-line config', () => {
    const config = extractFontConfig(`({
      subsets: [
        'latin',
        'latin-ext',
        'cyrillic',
      ],
      weight: [
        '400',
        '700',
      ],
      display: 'swap',
      variable: '--font-sans',
      style: [
        'normal',
        'italic',
      ],
      preload: true,
    })`);
    expect(config).not.toBeNull();
    expect(config!.subsets).toEqual(['latin', 'latin-ext', 'cyrillic']);
    expect(config!.weight).toEqual(['400', '700']);
    expect(config!.display).toBe('swap');
    expect(config!.variable).toBe('--font-sans');
    expect(config!.style).toEqual(['normal', 'italic']);
    expect(config!.preload).toBe(true);
  });
});

// ─── Dynamic call detection ──────────────────────────────────────────────────

describe('errors on dynamic font config', () => {
  it('detects variable argument', () => {
    const result = detectDynamicFontCall('const inter = Inter(fontConfig);', ['Inter']);
    expect(result).toBe('Inter(fontConfig)');
  });

  it('allows static object argument', () => {
    const result = detectDynamicFontCall("const inter = Inter({ subsets: ['latin'] });", ['Inter']);
    expect(result).toBeNull();
  });

  it('detects spread in function call', () => {
    const result = detectDynamicFontCall('const inter = Inter(...args);', ['Inter']);
    expect(result).toBe('Inter(...args)');
  });
});

// ─── Import parsing ──────────────────────────────────────────────────────────

describe('parses Google font imports', () => {
  it('parses single import', () => {
    const names = parseGoogleFontImports("import { Inter } from '@timber/fonts/google'");
    expect(names).toEqual(['Inter']);
  });

  it('parses multiple imports', () => {
    const names = parseGoogleFontImports(
      "import { Inter, JetBrains_Mono } from '@timber/fonts/google'"
    );
    expect(names).toEqual(['Inter', 'JetBrains_Mono']);
  });

  it('handles aliased imports', () => {
    const names = parseGoogleFontImports("import { Inter as MyFont } from '@timber/fonts/google'");
    expect(names).toEqual(['MyFont']);
  });

  it('returns empty for no matching imports', () => {
    const names = parseGoogleFontImports("import { useState } from 'react'");
    expect(names).toEqual([]);
  });

  it('parses next/font/google imports (compat)', () => {
    const names = parseGoogleFontImports("import { Geist, Geist_Mono } from 'next/font/google'");
    expect(names).toEqual(['Geist', 'Geist_Mono']);
  });
});

describe('parses Google font families', () => {
  it('maps local name to family name', () => {
    const families = parseGoogleFontFamilies("import { Inter } from '@timber/fonts/google'");
    expect(families.get('Inter')).toBe('Inter');
  });

  it('converts underscores to spaces in family name', () => {
    const families = parseGoogleFontFamilies(
      "import { JetBrains_Mono } from '@timber/fonts/google'"
    );
    expect(families.get('JetBrains_Mono')).toBe('JetBrains Mono');
  });

  it('handles aliased imports correctly', () => {
    const families = parseGoogleFontFamilies(
      "import { Inter as MyFont } from '@timber/fonts/google'"
    );
    expect(families.get('MyFont')).toBe('Inter');
  });

  it('parses next/font/google families (compat)', () => {
    const families = parseGoogleFontFamilies(
      "import { Geist_Mono } from 'next/font/google'"
    );
    expect(families.get('Geist_Mono')).toBe('Geist Mono');
  });
});

// ─── @font-face CSS generation ───────────────────────────────────────────────

describe('generates @font-face CSS', () => {
  it('generates basic @font-face rule', () => {
    const css = generateFontFace({
      family: 'Inter',
      src: "url('/fonts/inter.woff2') format('woff2')",
      weight: '400',
      style: 'normal',
      display: 'swap',
    });
    expect(css).toContain("font-family: 'Inter'");
    expect(css).toContain("src: url('/fonts/inter.woff2') format('woff2')");
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-style: normal');
    expect(css).toContain('font-display: swap');
  });

  it('includes unicode-range when specified', () => {
    const css = generateFontFace({
      family: 'Inter',
      src: "url('/fonts/inter.woff2') format('woff2')",
      unicodeRange: 'U+0000-00FF',
    });
    expect(css).toContain('unicode-range: U+0000-00FF');
  });

  it('omits optional fields when not provided', () => {
    const css = generateFontFace({
      family: 'Inter',
      src: "url('/fonts/inter.woff2') format('woff2')",
    });
    expect(css).not.toContain('font-weight');
    expect(css).not.toContain('font-style');
    expect(css).not.toContain('font-display');
    expect(css).not.toContain('unicode-range');
  });

  it('generates multiple @font-face rules', () => {
    const css = generateFontFaces([
      { family: 'Inter', src: "url('a.woff2') format('woff2')", weight: '400' },
      { family: 'Inter', src: "url('b.woff2') format('woff2')", weight: '700' },
    ]);
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-weight: 700');
    // Two separate blocks
    const blocks = css.split('@font-face');
    expect(blocks.length).toBe(3); // 1 empty prefix + 2 blocks
  });
});

// ─── Size-adjusted fallback generation ───────────────────────────────────────

describe('generates size-adjusted fallback', () => {
  it('generates fallback CSS for Inter', () => {
    const css = generateFallbackCss('Inter');
    expect(css).not.toBeNull();
    expect(css).toContain("font-family: 'Inter Fallback'");
    expect(css).toContain("src: local('Arial')");
    expect(css).toContain('size-adjust:');
    expect(css).toContain('ascent-override:');
    expect(css).toContain('descent-override:');
    expect(css).toContain('line-gap-override:');
  });

  it('generates fallback CSS for JetBrains Mono', () => {
    const css = generateFallbackCss('JetBrains Mono');
    expect(css).not.toBeNull();
    expect(css).toContain("font-family: 'JetBrains Mono Fallback'");
    expect(css).toContain("src: local('Courier New')");
  });

  it('returns null for unknown fonts', () => {
    const css = generateFallbackCss('Some Unknown Font');
    expect(css).toBeNull();
  });

  it('hasFallbackMetrics returns true for known fonts', () => {
    expect(hasFallbackMetrics('Inter')).toBe(true);
    expect(hasFallbackMetrics('Roboto')).toBe(true);
    expect(hasFallbackMetrics('inter')).toBe(true); // case insensitive
  });

  it('hasFallbackMetrics returns false for unknown fonts', () => {
    expect(hasFallbackMetrics('Unknown Font')).toBe(false);
  });
});

// ─── Font stack building ─────────────────────────────────────────────────────

describe('builds font stack', () => {
  it('builds stack with fallback for known font', () => {
    const stack = buildFontStack('Inter');
    expect(stack).toBe("'Inter', 'Inter Fallback', system-ui, sans-serif");
  });

  it('builds stack without fallback for unknown font', () => {
    const stack = buildFontStack('Custom Font');
    expect(stack).toBe("'Custom Font', system-ui, sans-serif");
  });

  it('uses monospace generic for mono fonts', () => {
    const stack = buildFontStack('JetBrains Mono');
    expect(stack).toContain('monospace');
    expect(stack).toContain('ui-monospace');
  });

  it('detects generic family correctly', () => {
    expect(getGenericFamily('Inter')).toBe('sans-serif');
    expect(getGenericFamily('JetBrains Mono')).toBe('monospace');
    expect(getGenericFamily('Source Code Pro')).toBe('monospace');
    expect(getGenericFamily('Playfair Display')).toBe('serif');
    expect(getGenericFamily('Merriweather')).toBe('serif');
  });
});

// ─── FontResult shape ────────────────────────────────────────────────────────

describe('returns correct FontResult shape', () => {
  it('FontResult includes className, style.fontFamily, and variable', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;

    const source = `
import { Inter } from '@timber/fonts/google'
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' })
`;

    const result = transform.call({ error: () => {} }, source, '/app/layout.tsx');
    expect(result).not.toBeNull();

    // The transformed code should contain a static object with className, style, variable
    expect(result!.code).toContain('className:');
    expect(result!.code).toContain('style:');
    expect(result!.code).toContain('fontFamily:');
    expect(result!.code).toContain('variable:');
    expect(result!.code).toContain('"--font-sans"');
    expect(result!.code).toContain('timber-font-inter');
  });

  it('FontResult omits variable when not specified', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;

    const source = `
import { Inter } from '@timber/fonts/google'
const inter = Inter({ subsets: ['latin'] })
`;

    const result = transform.call({ error: () => {} }, source, '/app/layout.tsx');
    expect(result).not.toBeNull();
    // Should NOT contain variable key
    expect(result!.code).not.toContain('variable:');
  });
});

// ─── CSS variable class generation ───────────────────────────────────────────

describe('generates CSS variable class', () => {
  it('generates variable class when variable is specified', () => {
    const css = generateVariableClass(
      'timber-font-inter',
      '--font-sans',
      "'Inter', 'Inter Fallback', system-ui, sans-serif"
    );
    expect(css).toContain('.timber-font-inter');
    expect(css).toContain('--font-sans:');
    expect(css).toContain("'Inter'");
  });

  it('generates font-family class when no variable', () => {
    const css = generateFontFamilyClass(
      'timber-font-inter',
      "'Inter', 'Inter Fallback', system-ui, sans-serif"
    );
    expect(css).toContain('.timber-font-inter');
    expect(css).toContain('font-family:');
    expect(css).toContain("'Inter'");
  });
});

// ─── Plugin resolveId ────────────────────────────────────────────────────────

describe('plugin resolveId', () => {
  it('resolves @timber/fonts/google to virtual module', () => {
    const plugin = timberFonts(createPluginContext());
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId.call({}, '@timber/fonts/google')).toBe('\0@timber/fonts/google');
  });

  it('resolves @timber/fonts/local to virtual module', () => {
    const plugin = timberFonts(createPluginContext());
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId.call({}, '@timber/fonts/local')).toBe('\0@timber/fonts/local');
  });

  it('returns null for unrelated imports', () => {
    const plugin = timberFonts(createPluginContext());
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId.call({}, 'react')).toBeNull();
  });
});

// ─── Plugin load ─────────────────────────────────────────────────────────────

describe('plugin load', () => {
  it('returns virtual module source for @timber/fonts/google', () => {
    const plugin = timberFonts(createPluginContext());
    const load = plugin.load as (id: string) => string | null;
    const result = load.call({}, '\0@timber/fonts/google');
    expect(result).not.toBeNull();
    expect(result).toContain('createFontResult');
  });

  it('returns virtual module source for @timber/fonts/local', () => {
    const plugin = timberFonts(createPluginContext());
    const load = plugin.load as (id: string) => string | null;
    const result = load.call({}, '\0@timber/fonts/local');
    expect(result).not.toBeNull();
    expect(result).toContain('localFont');
  });

  it('returns null for other modules', () => {
    const plugin = timberFonts(createPluginContext());
    const load = plugin.load as (id: string) => string | null;
    expect(load.call({}, 'react')).toBeNull();
  });
});

// ─── Plugin transform ────────────────────────────────────────────────────────

describe('plugin transform', () => {
  it('transforms font function calls to static objects', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;

    const source = `
import { Inter } from '@timber/fonts/google'
const inter = Inter({ subsets: ['latin'], weight: '400', display: 'swap' })
export default function Layout() { return null }
`;

    const result = transform.call({ error: () => {} }, source, '/app/layout.tsx');
    expect(result).not.toBeNull();
    // Import should be removed
    expect(result!.code).not.toContain("from '@timber/fonts/google'");
    // Call should be replaced with static object
    expect(result!.code).not.toContain('Inter(');
    expect(result!.code).toContain('timber-font-inter');
  });

  it('skips files without @timber/fonts/google imports', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => null;

    const result = transform.call(
      { error: () => {} },
      "import React from 'react'",
      '/app/page.tsx'
    );
    expect(result).toBeNull();
  });

  it('skips node_modules', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => null;

    const source = "import { Inter } from '@timber/fonts/google'";
    const result = transform.call({ error: () => {} }, source, '/node_modules/some-lib/index.js');
    expect(result).toBeNull();
  });

  it('skips virtual modules', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => null;

    const source = "import { Inter } from '@timber/fonts/google'";
    const result = transform.call({ error: () => {} }, source, '\0virtual:some-module');
    expect(result).toBeNull();
  });

  it('includes font stack with fallback in transformed output', () => {
    const plugin = timberFonts(createPluginContext());
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;

    const source = `
import { Inter } from '@timber/fonts/google'
const inter = Inter({ subsets: ['latin'], display: 'swap' })
`;

    const result = transform.call({ error: () => {} }, source, '/app/layout.tsx');
    expect(result).not.toBeNull();
    // Should include the fallback font in the stack
    expect(result!.code).toContain("'Inter'");
    expect(result!.code).toContain("'Inter Fallback'");
    expect(result!.code).toContain('sans-serif');
  });
});

// ─── generateAllFontCss ──────────────────────────────────────────────────────

describe('generateAllFontCss', () => {
  it('generates CSS for registered fonts', () => {
    const registry: FontRegistry = new Map();
    registry.set('inter-400-normal-latin', {
      id: 'inter-400-normal-latin',
      family: 'Inter',
      provider: 'google',
      weights: ['400'],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'swap',
      variable: '--font-sans',
      className: 'timber-font-inter',
      fontFamily: "'Inter', 'Inter Fallback', system-ui, sans-serif",
      importer: '/app/layout.tsx',
    });

    const css = generateAllFontCss(registry);
    // Should include fallback @font-face
    expect(css).toContain("font-family: 'Inter Fallback'");
    expect(css).toContain('size-adjust:');
    // Should include variable class
    expect(css).toContain('.timber-font-inter');
    expect(css).toContain('--font-sans:');
  });

  it('generates font-family class when no variable', () => {
    const registry: FontRegistry = new Map();
    registry.set('roboto-400-normal-latin', {
      id: 'roboto-400-normal-latin',
      family: 'Roboto',
      provider: 'google',
      weights: ['400'],
      styles: ['normal'],
      subsets: ['latin'],
      display: 'swap',
      className: 'timber-font-roboto',
      fontFamily: "'Roboto', 'Roboto Fallback', system-ui, sans-serif",
      importer: '/app/layout.tsx',
    });

    const css = generateAllFontCss(registry);
    expect(css).toContain('.timber-font-roboto');
    expect(css).toContain('font-family:');
    expect(css).not.toContain('--font');
  });
});
