/**
 * Google Fonts download, caching, and dev CDN fallback.
 *
 * At build time (production only):
 * 1. Queries Google Fonts CSS API v2 for font metadata and file URLs
 * 2. Downloads woff2 font files
 * 3. Caches them in node_modules/.cache/timber-fonts/
 * 4. Content-hashes filenames for cache busting
 * 5. Emits font files into the build output via generateBundle
 *
 * In dev mode:
 * - Generates @font-face rules pointing to Google Fonts CDN
 * - No downloads, no caching
 *
 * Design doc: 24-fonts.md §"Step 2: Font Download & Subsetting"
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtractedFont, FontFaceDescriptor } from './types.js';

/** Google Fonts CSS API v2 base URL. */
const GOOGLE_FONTS_API = 'https://fonts.googleapis.com/css2';

/**
 * User-Agent string that requests woff2 format from Google Fonts API.
 * Google serves different formats based on user-agent.
 */
const WOFF2_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Default cache directory for downloaded font files. */
const DEFAULT_CACHE_DIR = 'node_modules/.cache/timber-fonts';

/** A parsed @font-face block from the Google Fonts CSS response. */
export interface GoogleFontFace {
  family: string;
  weight: string;
  style: string;
  /** The remote URL to the font file. */
  url: string;
  /** The unicode-range from the CSS (e.g. `U+0000-00FF, U+0131`). */
  unicodeRange: string;
  /** Subset label extracted from the CSS comment (e.g. `latin`, `cyrillic`). */
  subset: string;
}

/** A downloaded and cached font file, ready for build output. */
export interface CachedFont {
  /** The original parsed face data. */
  face: GoogleFontFace;
  /** Content-hashed filename (e.g. `inter-latin-400-normal-abc123.woff2`). */
  hashedFilename: string;
  /** Absolute path to the cached file. */
  cachePath: string;
  /** Raw font file bytes. */
  data: Buffer;
}

/**
 * Build the Google Fonts CSS API v2 URL for a given font config.
 *
 * Example output:
 * https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap&subset=latin
 */
export function buildGoogleFontsUrl(font: ExtractedFont): string {
  const family = font.family.replace(/\s+/g, '+');

  // Build axis spec: wght for weights, ital for italic styles
  const hasItalic = font.styles.includes('italic');
  const weights = font.weights.map(Number).sort((a, b) => a - b);

  let axisSpec: string;
  if (hasItalic && weights.length > 0) {
    // ital,wght@0,400;0,700;1,400;1,700
    const pairs: string[] = [];
    for (const ital of [0, 1]) {
      if (ital === 1 && !hasItalic) continue;
      if (ital === 0 && font.styles.length === 1 && font.styles[0] === 'italic') continue;
      for (const w of weights) {
        pairs.push(`${ital},${w}`);
      }
    }
    axisSpec = `ital,wght@${pairs.join(';')}`;
  } else if (weights.length > 0) {
    axisSpec = `wght@${weights.join(';')}`;
  } else {
    axisSpec = '';
  }

  const familyParam = axisSpec ? `${family}:${axisSpec}` : family;

  // Build URL manually — URLSearchParams encodes +, :, @, ; which
  // the Google Fonts CSS API v2 requires as literal characters.
  const parts = [`family=${familyParam}`];
  if (font.display) parts.push(`display=${font.display}`);

  return `${GOOGLE_FONTS_API}?${parts.join('&')}`;
}

/**
 * Fetch the CSS from Google Fonts API and parse out @font-face blocks.
 *
 * The API returns CSS with subset comments like:
 * ```
 * /* latin * /
 * @font-face { ... }
 * ```
 *
 * We parse each block to extract the font URL, unicode-range, and subset label.
 */
export async function fetchGoogleFontsCss(url: string): Promise<GoogleFontFace[]> {
  const response = await fetch(url, {
    headers: { 'User-Agent': WOFF2_USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(
      `Google Fonts API returned ${response.status}: ${response.statusText} for ${url}`
    );
  }

  const css = await response.text();
  return parseGoogleFontsCss(css);
}

/**
 * Parse the CSS response from Google Fonts API into structured font face data.
 *
 * Handles the Google Fonts CSS format with subset comments and @font-face blocks.
 */
export function parseGoogleFontsCss(css: string): GoogleFontFace[] {
  const faces: GoogleFontFace[] = [];

  // Match subset comments followed by @font-face blocks
  const blockPattern = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g;

  let match;
  while ((match = blockPattern.exec(css)) !== null) {
    const subset = match[1];
    const block = match[2];

    const familyMatch = block.match(/font-family:\s*'([^']+)'/);
    const weightMatch = block.match(/font-weight:\s*(\d+)/);
    const styleMatch = block.match(/font-style:\s*(\w+)/);
    const urlMatch = block.match(/url\(([^)]+)\)\s*format\('woff2'\)/);
    const rangeMatch = block.match(/unicode-range:\s*([^;]+)/);

    if (familyMatch && urlMatch) {
      faces.push({
        family: familyMatch[1],
        weight: weightMatch?.[1] ?? '400',
        style: styleMatch?.[1] ?? 'normal',
        url: urlMatch[1],
        unicodeRange: rangeMatch?.[1]?.trim() ?? '',
        subset,
      });
    }
  }

  return faces;
}

/**
 * Filter parsed font faces to only the requested subsets.
 */
export function filterBySubsets(faces: GoogleFontFace[], subsets: string[]): GoogleFontFace[] {
  if (subsets.length === 0) return faces;
  const subsetSet = new Set(subsets);
  return faces.filter((f) => subsetSet.has(f.subset));
}

/**
 * Generate a content hash for font data.
 * Returns the first 8 hex chars of the SHA-256 hash.
 */
export function contentHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 8);
}

/**
 * Generate a content-hashed filename for a font face.
 *
 * Format: `<family>-<subset>-<weight>-<style>-<hash>.woff2`
 * Example: `inter-latin-400-normal-abc12345.woff2`
 */
export function hashedFontFilename(face: GoogleFontFace, data: Buffer): string {
  const slug = face.family.toLowerCase().replace(/\s+/g, '-');
  const hash = contentHash(data);
  return `${slug}-${face.subset}-${face.weight}-${face.style}-${hash}.woff2`;
}

/**
 * Build the cache key for a font face.
 * Used to check if a font has already been downloaded.
 */
export function cacheKey(face: GoogleFontFace): string {
  const slug = face.family.toLowerCase().replace(/\s+/g, '-');
  return `${slug}-${face.subset}-${face.weight}-${face.style}`;
}

/**
 * Download a single font file from its URL.
 */
export async function downloadFontFile(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download font from ${url}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Download and cache all font files for a set of extracted Google fonts.
 *
 * - Checks the local cache first (node_modules/.cache/timber-fonts/)
 * - Downloads missing fonts from Google Fonts CDN
 * - Writes downloaded fonts to cache
 * - Returns CachedFont entries with content-hashed filenames
 */
export async function downloadAndCacheFonts(
  fonts: ExtractedFont[],
  projectRoot: string
): Promise<CachedFont[]> {
  const cacheDir = join(projectRoot, DEFAULT_CACHE_DIR);
  await mkdir(cacheDir, { recursive: true });

  const googleFonts = fonts.filter((f) => f.provider === 'google');
  const cached: CachedFont[] = [];

  for (const font of googleFonts) {
    const apiUrl = buildGoogleFontsUrl(font);
    const faces = await fetchGoogleFontsCss(apiUrl);
    const filtered = filterBySubsets(faces, font.subsets);

    for (const face of filtered) {
      const key = cacheKey(face);
      const metaPath = join(cacheDir, `${key}.meta.json`);
      const dataPath = join(cacheDir, `${key}.woff2`);

      let data: Buffer;
      let filename: string;

      // Check cache
      const cacheHit = await isCacheHit(metaPath, dataPath);
      if (cacheHit) {
        data = await readFile(dataPath);
        const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
        filename = meta.hashedFilename;
      } else {
        // Download and cache
        data = await downloadFontFile(face.url);
        filename = hashedFontFilename(face, data);

        await writeFile(dataPath, data);
        await writeFile(metaPath, JSON.stringify({ hashedFilename: filename, url: face.url }));
      }

      cached.push({ face, hashedFilename: filename, cachePath: dataPath, data });
    }
  }

  return cached;
}

/**
 * Check if both the meta and data files exist in the cache.
 */
async function isCacheHit(metaPath: string, dataPath: string): Promise<boolean> {
  try {
    await stat(metaPath);
    await stat(dataPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate @font-face descriptors for cached (production) Google Fonts.
 *
 * Each CachedFont gets a FontFaceDescriptor pointing to the
 * content-hashed URL under `/_timber/fonts/`.
 */
export function generateProductionFontFaces(
  cachedFonts: CachedFont[],
  display: string
): FontFaceDescriptor[] {
  return cachedFonts.map((cf) => ({
    family: cf.face.family,
    src: `url('/_timber/fonts/${cf.hashedFilename}') format('woff2')`,
    weight: cf.face.weight,
    style: cf.face.style,
    display,
    unicodeRange: cf.face.unicodeRange,
  }));
}

/**
 * Generate @font-face descriptors for dev mode (CDN-pointing).
 *
 * In dev mode, we query the Google Fonts API but use the CDN URLs
 * directly instead of downloading. This avoids the download/cache
 * step during `vite dev`.
 */
export function generateDevFontFaces(
  faces: GoogleFontFace[],
  display: string
): FontFaceDescriptor[] {
  return faces.map((face) => ({
    family: face.family,
    src: `url('${face.url}') format('woff2')`,
    weight: face.weight,
    style: face.style,
    display,
    unicodeRange: face.unicodeRange,
  }));
}

/**
 * Resolve dev-mode font faces for an extracted font.
 *
 * Fetches the CSS from Google Fonts API and returns FontFaceDescriptors
 * pointing to CDN URLs. No files are downloaded.
 */
export async function resolveDevFontFaces(font: ExtractedFont): Promise<FontFaceDescriptor[]> {
  const apiUrl = buildGoogleFontsUrl(font);
  const faces = await fetchGoogleFontsCss(apiUrl);
  const filtered = filterBySubsets(faces, font.subsets);
  return generateDevFontFaces(filtered, font.display);
}
