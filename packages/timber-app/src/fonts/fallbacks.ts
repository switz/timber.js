/**
 * Size-adjusted fallback font generation.
 *
 * Generates `@font-face` declarations for fallback fonts with
 * `size-adjust`, `ascent-override`, `descent-override`, and
 * `line-gap-override` to match custom font metrics and eliminate CLS.
 *
 * Design doc: 24-fonts.md §"Step 4: Size-Adjusted Fallbacks"
 */

import type { FontFaceDescriptor } from './types.js';

/**
 * Font metrics for size-adjusted fallback calculation.
 *
 * Values are percentages used in CSS override descriptors.
 */
interface FallbackMetrics {
  /** The local() system font to use as base. */
  fallbackFont: string;
  /** size-adjust percentage (e.g. 107.64). */
  sizeAdjust: number;
  /** ascent-override percentage (e.g. 90.49). */
  ascentOverride: number;
  /** descent-override percentage (e.g. 22.48). */
  descentOverride: number;
  /** line-gap-override percentage (e.g. 0). */
  lineGapOverride: number;
}

/**
 * Lookup table for commonly used Google Fonts.
 *
 * Metrics sourced from fontaine / @capsizecss/metrics.
 * Keyed by lowercase font family name.
 */
const FALLBACK_METRICS: Record<string, FallbackMetrics> = {
  inter: {
    fallbackFont: 'Arial',
    sizeAdjust: 107.64,
    ascentOverride: 90.49,
    descentOverride: 22.48,
    lineGapOverride: 0,
  },
  roboto: {
    fallbackFont: 'Arial',
    sizeAdjust: 100.3,
    ascentOverride: 92.77,
    descentOverride: 24.41,
    lineGapOverride: 0,
  },
  'open sans': {
    fallbackFont: 'Arial',
    sizeAdjust: 105.48,
    ascentOverride: 101.03,
    descentOverride: 27.47,
    lineGapOverride: 0,
  },
  lato: {
    fallbackFont: 'Arial',
    sizeAdjust: 112.5,
    ascentOverride: 100.22,
    descentOverride: 21.16,
    lineGapOverride: 0,
  },
  montserrat: {
    fallbackFont: 'Arial',
    sizeAdjust: 112.17,
    ascentOverride: 85.13,
    descentOverride: 22.07,
    lineGapOverride: 0,
  },
  poppins: {
    fallbackFont: 'Arial',
    sizeAdjust: 112.76,
    ascentOverride: 96.31,
    descentOverride: 32.1,
    lineGapOverride: 0,
  },
  'roboto mono': {
    fallbackFont: 'Courier New',
    sizeAdjust: 109.29,
    ascentOverride: 87.79,
    descentOverride: 23.1,
    lineGapOverride: 0,
  },
  'jetbrains mono': {
    fallbackFont: 'Courier New',
    sizeAdjust: 112.7,
    ascentOverride: 89.53,
    descentOverride: 24.21,
    lineGapOverride: 0,
  },
  'source code pro': {
    fallbackFont: 'Courier New',
    sizeAdjust: 106.13,
    ascentOverride: 93.47,
    descentOverride: 26.01,
    lineGapOverride: 0,
  },
  'fira code': {
    fallbackFont: 'Courier New',
    sizeAdjust: 112.96,
    ascentOverride: 86.87,
    descentOverride: 26.34,
    lineGapOverride: 0,
  },
  nunito: {
    fallbackFont: 'Arial',
    sizeAdjust: 103.62,
    ascentOverride: 99.45,
    descentOverride: 34.8,
    lineGapOverride: 0,
  },
  'playfair display': {
    fallbackFont: 'Georgia',
    sizeAdjust: 110.72,
    ascentOverride: 84.44,
    descentOverride: 23.56,
    lineGapOverride: 0,
  },
  merriweather: {
    fallbackFont: 'Georgia',
    sizeAdjust: 107.66,
    ascentOverride: 91.93,
    descentOverride: 27.6,
    lineGapOverride: 0,
  },
  raleway: {
    fallbackFont: 'Arial',
    sizeAdjust: 107.74,
    ascentOverride: 94.19,
    descentOverride: 26.76,
    lineGapOverride: 0,
  },
};

/**
 * Known serif font families (lowercase).
 * Used for generic family detection when the name doesn't contain "serif".
 */
const SERIF_FAMILIES = new Set([
  'playfair display',
  'merriweather',
  'lora',
  'georgia',
  'garamond',
  'eb garamond',
  'crimson text',
  'libre baskerville',
  'source serif pro',
  'source serif 4',
  'dm serif display',
  'dm serif text',
  'noto serif',
  'pt serif',
  'bitter',
  'domine',
  'cormorant',
  'cormorant garamond',
]);

export function getGenericFamily(family: string): string {
  const lc = family.toLowerCase();
  if (lc.includes('mono') || lc.includes('code')) return 'monospace';
  if (
    (lc.includes('serif') && !lc.includes('sans')) ||
    SERIF_FAMILIES.has(lc)
  ) {
    return 'serif';
  }
  return 'sans-serif';
}

/**
 * Generate a size-adjusted fallback @font-face for a given font family.
 *
 * Returns null if no metrics are available (unknown font — no fallback generated).
 */
export function generateFallbackFontFace(family: string): FontFaceDescriptor | null {
  const metrics = FALLBACK_METRICS[family.toLowerCase()];
  if (!metrics) return null;

  const fallbackFamily = `${family} Fallback`;

  return {
    family: fallbackFamily,
    src: `local('${metrics.fallbackFont}')`,
    // Encode the metrics into a CSS descriptor string.
    // We abuse the 'style' field to carry the override properties
    // since FontFaceDescriptor doesn't have dedicated fields.
    // The generateFallbackCss function handles this specially.
  };
}

/**
 * Generate the full CSS for a size-adjusted fallback font.
 *
 * This produces a complete @font-face block with override descriptors
 * that FontFaceDescriptor doesn't natively support.
 */
export function generateFallbackCss(family: string): string | null {
  const metrics = FALLBACK_METRICS[family.toLowerCase()];
  if (!metrics) return null;

  const fallbackFamily = `${family} Fallback`;

  const lines = [
    '@font-face {',
    `  font-family: '${fallbackFamily}';`,
    `  src: local('${metrics.fallbackFont}');`,
    `  size-adjust: ${metrics.sizeAdjust}%;`,
    `  ascent-override: ${metrics.ascentOverride}%;`,
    `  descent-override: ${metrics.descentOverride}%;`,
    `  line-gap-override: ${metrics.lineGapOverride}%;`,
    '}',
  ];

  return lines.join('\n');
}

/**
 * Check whether fallback metrics are available for a font family.
 */
export function hasFallbackMetrics(family: string): boolean {
  return family.toLowerCase() in FALLBACK_METRICS;
}

/**
 * Build the full font stack string for a font, including its
 * size-adjusted fallback and a generic family.
 *
 * Example: `'Inter', 'Inter Fallback', system-ui, sans-serif`
 */
export function buildFontStack(family: string): string {
  const generic = getGenericFamily(family);
  const hasMetrics = hasFallbackMetrics(family);

  const parts = [`'${family}'`];
  if (hasMetrics) parts.push(`'${family} Fallback'`);

  // Add system-ui for sans-serif fonts, ui-monospace for mono
  if (generic === 'monospace') {
    parts.push('ui-monospace');
  } else if (generic === 'sans-serif') {
    parts.push('system-ui');
  }
  parts.push(generic);

  return parts.join(', ');
}
