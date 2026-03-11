/**
 * Local font processing for the timber-fonts pipeline.
 *
 * Handles:
 * - Resolving font file paths relative to the importing module
 * - Normalizing single-string `src` to array form
 * - Generating @font-face descriptors for each weight/style variant
 *
 * Does NOT handle:
 * - Font format conversion (serve whatever the user provides)
 * - Font subsetting (user's responsibility for local fonts)
 *
 * Design doc: 24-fonts.md §"Local Fonts"
 */

import { resolve, dirname, extname } from 'node:path';
import type { LocalFontConfig, LocalFontSrc, FontFaceDescriptor, ExtractedFont } from './types.js';
import { buildFontStack } from './fallbacks.js';
import { extractLocalFontConfigAst } from './ast.js';

/**
 * Infer the font format from a file extension.
 *
 * Returns the CSS `format()` value for `@font-face` src descriptors.
 */
export function inferFontFormat(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.woff2':
      return 'woff2';
    case '.woff':
      return 'woff';
    case '.ttf':
      return 'truetype';
    case '.otf':
      return 'opentype';
    case '.eot':
      return 'embedded-opentype';
    default:
      return 'woff2';
  }
}

/**
 * Normalize `src` config to an array of LocalFontSrc entries.
 *
 * When `src` is a single string, it becomes a single entry with
 * default weight '400' and style 'normal'.
 */
export function normalizeSrc(src: string | LocalFontSrc[]): LocalFontSrc[] {
  if (typeof src === 'string') {
    return [{ path: src, weight: '400', style: 'normal' }];
  }
  return src.map((entry) => ({
    path: entry.path,
    weight: entry.weight ?? '400',
    style: entry.style ?? 'normal',
  }));
}

/**
 * Resolve font file paths relative to the importing module's directory.
 *
 * Takes the importer's file path and the normalized src entries,
 * returns new entries with absolute resolved paths.
 */
export function resolveLocalFontPaths(
  importerPath: string,
  sources: LocalFontSrc[]
): LocalFontSrc[] {
  const importerDir = dirname(importerPath);
  return sources.map((entry) => ({
    ...entry,
    path: resolve(importerDir, entry.path),
  }));
}

/**
 * Generate a deterministic font family name from the file path
 * when no explicit `family` is provided.
 *
 * Uses the filename without extension, e.g. "MyFont-Regular.woff2" → "MyFont-Regular".
 * For multi-weight sources, uses the first file's name stem.
 */
export function generateFamilyName(sources: LocalFontSrc[]): string {
  if (sources.length === 0) return 'Local Font';
  const firstPath = sources[0].path;
  const basename = firstPath.split('/').pop() ?? firstPath;
  // Remove extension and weight/style suffixes for a cleaner family name
  const stem = basename.replace(/\.[^.]+$/, '');
  // Strip common weight/style suffixes to get the family root
  const family = stem.replace(
    /[-_]?(Regular|Bold|Italic|Light|Medium|SemiBold|ExtraBold|Thin|Black|Heavy)$/i,
    ''
  );
  return family || stem;
}

/**
 * Generate @font-face descriptors for local font sources.
 *
 * Each source entry produces one @font-face rule. The `src` descriptor
 * uses a `url()` pointing to the resolved file path with the inferred format.
 */
export function generateLocalFontFaces(
  family: string,
  sources: LocalFontSrc[],
  display: string
): FontFaceDescriptor[] {
  return sources.map((entry) => {
    const format = inferFontFormat(entry.path);
    return {
      family,
      src: `url('${entry.path}') format('${format}')`,
      weight: entry.weight,
      style: entry.style,
      display,
    };
  });
}

/**
 * Build the className for a local font, following the same convention
 * as Google fonts: `timber-font-<lowercase-hyphenated-family>`.
 */
export function localFontClassName(family: string): string {
  return `timber-font-${family.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Process a local font config into an ExtractedFont.
 *
 * This is the main entry point called by the fonts plugin's transform hook
 * when it encounters a `localFont()` call.
 */
export function processLocalFont(config: LocalFontConfig, importerPath: string): ExtractedFont {
  const sources = normalizeSrc(config.src);
  const resolvedSources = resolveLocalFontPaths(importerPath, sources);
  const family = config.family ?? generateFamilyName(sources);
  const display = config.display ?? 'swap';
  const className = localFontClassName(family);
  const fontStack = buildFontStack(family);

  const weights = [...new Set(resolvedSources.map((s) => s.weight ?? '400'))];
  const styles = [...new Set(resolvedSources.map((s) => s.style ?? 'normal'))];

  return {
    id: `local-${family.toLowerCase().replace(/\s+/g, '-')}-${weights.join(',')}-${styles.join(',')}`,
    family,
    provider: 'local',
    weights,
    styles,
    subsets: [],
    display,
    variable: config.variable,
    localSources: resolvedSources,
    importer: importerPath,
    className,
    fontFamily: fontStack,
  };
}

/**
 * Extract a LocalFontConfig from a static `localFont()` call source.
 *
 * Parses patterns like:
 *   localFont({ src: './fonts/MyFont.woff2', display: 'swap', variable: '--font-custom' })
 *   localFont({ src: [{ path: './a.woff2', weight: '400' }, { path: './b.woff2', weight: '700' }] })
 *
 * Returns null if the call cannot be statically analyzed.
 *
 * Uses acorn AST parsing for robust handling of comments, trailing commas,
 * and multi-line configs.
 */
export function extractLocalFontConfig(callSource: string): LocalFontConfig | null {
  return extractLocalFontConfigAst(callSource);
}
