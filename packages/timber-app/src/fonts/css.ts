/**
 * @font-face CSS generation.
 *
 * Generates CSS strings from font face descriptors. Used by both
 * Google and local font providers.
 *
 * Design doc: 24-fonts.md §"Step 3: @font-face Generation"
 */

import type { FontFaceDescriptor } from './types.js';

/**
 * Generate a single `@font-face` CSS rule from a descriptor.
 */
export function generateFontFace(desc: FontFaceDescriptor): string {
  const lines: string[] = [];
  lines.push('@font-face {');
  lines.push(`  font-family: '${desc.family}';`);
  lines.push(`  src: ${desc.src};`);
  if (desc.weight) lines.push(`  font-weight: ${desc.weight};`);
  if (desc.style) lines.push(`  font-style: ${desc.style};`);
  if (desc.display) lines.push(`  font-display: ${desc.display};`);
  if (desc.unicodeRange) lines.push(`  unicode-range: ${desc.unicodeRange};`);
  lines.push('}');
  return lines.join('\n');
}

/**
 * Generate multiple `@font-face` rules from an array of descriptors.
 */
export function generateFontFaces(descriptors: FontFaceDescriptor[]): string {
  return descriptors.map(generateFontFace).join('\n\n');
}

/**
 * Generate a scoped CSS class that sets a CSS custom property for the font.
 *
 * Example output:
 * ```css
 * .timber-font-inter {
 *   --font-sans: 'Inter', 'Inter Fallback', system-ui, sans-serif;
 * }
 * ```
 */
export function generateVariableClass(
  className: string,
  variable: string,
  fontFamily: string
): string {
  return `.${className} {\n  ${variable}: ${fontFamily};\n}`;
}

/**
 * Generate a scoped CSS class that applies font-family directly.
 *
 * Used when no `variable` is specified — the className applies
 * the font-family inline instead of through a CSS custom property.
 *
 * Example output:
 * ```css
 * .timber-font-inter {
 *   font-family: 'Inter', 'Inter Fallback', system-ui, sans-serif;
 * }
 * ```
 */
export function generateFontFamilyClass(className: string, fontFamily: string): string {
  return `.${className} {\n  font-family: ${fontFamily};\n}`;
}
