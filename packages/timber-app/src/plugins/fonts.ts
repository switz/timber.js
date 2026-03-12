/**
 * timber-fonts — Vite sub-plugin for build-time font processing.
 *
 * Handles:
 * - Virtual module resolution for `@timber/fonts/google` and `@timber/fonts/local`
 * - Static analysis of font function calls during `transform`
 * - @font-face CSS generation and scoped class output
 * - Size-adjusted fallback font generation
 *
 * Does NOT handle (separate tasks):
 * - Google Fonts downloading/caching (timber-nk5)
 * - Build manifest / Early Hints integration (timber-qnx)
 *
 * Design doc: 24-fonts.md
 */

import type { Plugin } from 'vite';
import type { PluginContext } from '../index.js';
import type { ExtractedFont, GoogleFontConfig } from '../fonts/types.js';
import type { ManifestFontEntry } from '../server/build-manifest.js';
import { generateVariableClass, generateFontFamilyClass } from '../fonts/css.js';
import { generateFallbackCss, buildFontStack } from '../fonts/fallbacks.js';
import { processLocalFont } from '../fonts/local.js';
import { inferFontFormat } from '../fonts/local.js';
import { downloadAndCacheFonts, type CachedFont } from '../fonts/google.js';
import {
  extractFontConfigAst,
  extractLocalFontConfigAst,
  detectDynamicFontCallAst,
} from '../fonts/ast.js';

const VIRTUAL_GOOGLE = '@timber/fonts/google';
const VIRTUAL_LOCAL = '@timber/fonts/local';
const RESOLVED_GOOGLE = '\0@timber/fonts/google';
const RESOLVED_LOCAL = '\0@timber/fonts/local';

/**
 * Registry of fonts extracted during transform.
 * Keyed by a unique font ID derived from family + config.
 */
export type FontRegistry = Map<string, ExtractedFont>;

/**
 * Convert a font family name to a PascalCase export name.
 * e.g. "JetBrains Mono" → "JetBrains_Mono"
 */
function familyToExportName(family: string): string {
  return family.replace(/\s+/g, '_');
}

/**
 * Convert a font family name to a scoped class name.
 * e.g. "JetBrains Mono" → "timber-font-jetbrains-mono"
 */
function familyToClassName(family: string): string {
  return `timber-font-${family.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Generate a unique font ID from family + config hash.
 */
function generateFontId(family: string, config: GoogleFontConfig): string {
  const weights = normalizeToArray(config.weight);
  const styles = normalizeToArray(config.style);
  const subsets = config.subsets ?? ['latin'];
  return `${family.toLowerCase()}-${weights.join(',')}-${styles.join(',')}-${subsets.join(',')}`;
}

/**
 * Normalize a string or string array to an array.
 */
function normalizeToArray(value: string | string[] | undefined): string[] {
  if (!value) return ['400'];
  return Array.isArray(value) ? value : [value];
}

/**
 * Normalize style to an array.
 */
function normalizeStyleArray(value: string | string[] | undefined): string[] {
  if (!value) return ['normal'];
  return Array.isArray(value) ? value : [value];
}

/**
 * Extract static font config from a font function call in source code.
 *
 * Parses patterns like:
 *   const inter = Inter({ subsets: ['latin'], weight: '400', display: 'swap', variable: '--font-sans' })
 *
 * Returns null if the call cannot be statically analyzed.
 *
 * Uses acorn AST parsing for robust handling of comments, trailing commas,
 * and multi-line configs.
 */
export function extractFontConfig(callSource: string): GoogleFontConfig | null {
  return extractFontConfigAst(callSource);
}

/**
 * Detect if a source file contains dynamic/computed font function calls
 * that cannot be statically analyzed.
 *
 * Returns the offending expression if found, null if all calls are static.
 *
 * Uses acorn AST parsing for accurate detection.
 */
export function detectDynamicFontCall(source: string, importedNames: string[]): string | null {
  return detectDynamicFontCallAst(source, importedNames);
}

/**
 * Regex that matches imports from either `@timber/fonts/google` or `next/font/google`.
 * The shims plugin resolves `next/font/google` to the same virtual module,
 * but the source code still contains the original import specifier.
 */
const GOOGLE_FONT_IMPORT_RE =
  /import\s*\{([^}]+)\}\s*from\s*['"](?:@timber\/fonts\/google|next\/font\/google)['"]/g;

/**
 * Parse import specifiers from a source file that imports from
 * `@timber/fonts/google` or `next/font/google`.
 *
 * Returns the list of imported font names (e.g. ['Inter', 'JetBrains_Mono']).
 */
export function parseGoogleFontImports(source: string): string[] {
  const importPattern = new RegExp(GOOGLE_FONT_IMPORT_RE.source, 'g');
  const names: string[] = [];

  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const specifiers = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const spec of specifiers) {
      // Handle `Inter as MyInter` — we want the local name
      const parts = spec.split(/\s+as\s+/);
      names.push(parts[parts.length - 1].trim());
    }
  }

  return names;
}

/**
 * Parse the original (remote) font family names from imports.
 *
 * Returns a map of local name → family name.
 * e.g. { Inter: 'Inter', JetBrains_Mono: 'JetBrains Mono' }
 */
export function parseGoogleFontFamilies(source: string): Map<string, string> {
  const importPattern = new RegExp(GOOGLE_FONT_IMPORT_RE.source, 'g');
  const families = new Map<string, string>();

  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const specifiers = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const spec of specifiers) {
      const parts = spec.split(/\s+as\s+/);
      const originalName = parts[0].trim();
      const localName = parts[parts.length - 1].trim();
      // Convert export name back to family name: JetBrains_Mono → JetBrains Mono
      const family = originalName.replace(/_/g, ' ');
      families.set(localName, family);
    }
  }

  return families;
}

/**
 * Generate the virtual module source for `@timber/fonts/google`.
 *
 * Each Google Font family gets a named export that returns a FontResult.
 * In this base implementation, the functions return static data.
 * The Google Fonts download task (timber-nk5) will add real font file URLs.
 */
function generateGoogleVirtualModule(registry: FontRegistry): string {
  // Collect unique families from the registry
  const families = new Set<string>();
  for (const font of registry.values()) {
    if (font.provider === 'google') families.add(font.family);
  }

  const lines = [
    '// Auto-generated virtual module: @timber/fonts/google',
    '// Each export is a font loader function that returns a FontResult.',
    '',
  ];

  // If no fonts registered yet, export a generic loader for any font
  // This is the initial load — the transform hook will process actual calls
  lines.push('function createFontResult(family, config) {');
  lines.push('  return {');
  lines.push('    className: `timber-font-${family.toLowerCase().replace(/\\s+/g, "-")}`,');
  lines.push('    style: { fontFamily: family },');
  lines.push('    variable: config?.variable,');
  lines.push('  };');
  lines.push('}');
  lines.push('');

  // Export a Proxy-based default that handles any font name import
  lines.push('export default new Proxy({}, {');
  lines.push('  get(_, prop) {');
  lines.push('    if (typeof prop === "string") {');
  lines.push('      return (config) => createFontResult(prop.replace(/_/g, " "), config);');
  lines.push('    }');
  lines.push('  }');
  lines.push('});');

  // Also export known families as named exports for tree-shaking
  for (const family of families) {
    const exportName = familyToExportName(family);
    lines.push('');
    lines.push(`export function ${exportName}(config) {`);
    lines.push(`  return createFontResult('${family}', config);`);
    lines.push('}');
  }

  return lines.join('\n');
}

/**
 * Generate the virtual module source for `@timber/fonts/local`.
 */
function generateLocalVirtualModule(): string {
  return [
    '// Auto-generated virtual module: @timber/fonts/local',
    '',
    'export default function localFont(config) {',
    '  const family = config?.family || "Local Font";',
    '  return {',
    '    className: `timber-font-${family.toLowerCase().replace(/\\s+/g, "-")}`,',
    '    style: { fontFamily: family },',
    '    variable: config?.variable,',
    '  };',
    '}',
  ].join('\n');
}

/**
 * Generate the CSS output for all extracted fonts.
 *
 * Includes @font-face rules, fallback @font-face rules, and scoped classes.
 */
export function generateAllFontCss(registry: FontRegistry): string {
  const cssParts: string[] = [];

  for (const font of registry.values()) {
    // Generate fallback @font-face if metrics are available
    const fallbackCss = generateFallbackCss(font.family);
    if (fallbackCss) cssParts.push(fallbackCss);

    // Generate scoped class
    if (font.variable) {
      cssParts.push(generateVariableClass(font.className, font.variable, font.fontFamily));
    } else {
      cssParts.push(generateFontFamilyClass(font.className, font.fontFamily));
    }
  }

  return cssParts.join('\n\n');
}

/**
 * Parse the local name used for the default import of `@timber/fonts/local`.
 *
 * Handles:
 *   import localFont from '@timber/fonts/local'
 *   import myLoader from '@timber/fonts/local'
 */
export function parseLocalFontImportName(source: string): string | null {
  const match = source.match(
    /import\s+(\w+)\s+from\s*['"](?:@timber\/fonts\/local|next\/font\/local)['"]/
  );
  return match ? match[1] : null;
}

/**
 * Transform local font calls in source code.
 *
 * Finds `localFont({ ... })` calls, extracts the config,
 * registers the font, and replaces the call with a static FontResult.
 */
function transformLocalFonts(
  transformedCode: string,
  originalCode: string,
  importerId: string,
  registry: FontRegistry,
  emitError: (msg: string) => void
): string {
  const localName = parseLocalFontImportName(originalCode);
  if (!localName) return transformedCode;

  // Check for dynamic calls
  const dynamicCall = detectDynamicFontCall(originalCode, [localName]);
  if (dynamicCall) {
    emitError(
      `Font function calls must be statically analyzable. ` +
        `Found dynamic call: ${dynamicCall}. ` +
        `Pass a literal object with string/array values instead.`
    );
  }

  // Find all calls: const varName = localFont({ ... })
  const callPattern = new RegExp(
    `(?:const|let|var)\\s+(\\w+)\\s*=\\s*${localName}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`,
    'g'
  );

  let callMatch;
  while ((callMatch = callPattern.exec(originalCode)) !== null) {
    const varName = callMatch[1];
    const configSource = callMatch[2];
    const fullMatch = callMatch[0];

    const config = extractLocalFontConfigAst(`(${configSource})`);
    if (!config) {
      emitError(
        `Could not statically analyze local font config. ` +
          `Ensure src is a string or array of { path, weight?, style? } objects.`
      );
      return transformedCode;
    }

    const extracted = processLocalFont(config, importerId);
    registry.set(extracted.id, extracted);

    const resultObj = extracted.variable
      ? `{ className: "${extracted.className}", style: { fontFamily: "${extracted.fontFamily}" }, variable: "${extracted.variable}" }`
      : `{ className: "${extracted.className}", style: { fontFamily: "${extracted.fontFamily}" } }`;

    const replacement = `const ${varName} = ${resultObj}`;
    transformedCode = transformedCode.replace(fullMatch, replacement);
  }

  // Remove the import statement
  transformedCode = transformedCode.replace(
    /import\s+\w+\s+from\s*['"](?:@timber\/fonts\/local|next\/font\/local)['"];?\s*\n?/g,
    ''
  );

  return transformedCode;
}

/**
 * Create the timber-fonts Vite plugin.
 */
export function timberFonts(ctx: PluginContext): Plugin {
  const registry: FontRegistry = new Map();
  /** Fonts downloaded during buildStart (production only). */
  let cachedFonts: CachedFont[] = [];

  return {
    name: 'timber-fonts',

    /**
     * Resolve `@timber/fonts/google` and `@timber/fonts/local` to virtual modules.
     */
    resolveId(id: string) {
      if (id === VIRTUAL_GOOGLE) return RESOLVED_GOOGLE;
      if (id === VIRTUAL_LOCAL) return RESOLVED_LOCAL;
      return null;
    },

    /**
     * Return generated source for font virtual modules.
     */
    load(id: string) {
      if (id === RESOLVED_GOOGLE) return generateGoogleVirtualModule(registry);
      if (id === RESOLVED_LOCAL) return generateLocalVirtualModule();
      return null;
    },

    /**
     * Download and cache Google Fonts during production builds.
     *
     * In dev mode this is a no-op — fonts point to the Google CDN.
     * The registry is populated by the transform hook which runs before
     * buildStart in the build pipeline, so all fonts are known here.
     */
    async buildStart() {
      if (ctx.dev) return;

      const googleFonts = [...registry.values()].filter((f) => f.provider === 'google');
      if (googleFonts.length === 0) return;

      cachedFonts = await downloadAndCacheFonts(googleFonts, ctx.root);
    },

    /**
     * Scan source files for font function calls and extract static config.
     *
     * When a file imports from `@timber/fonts/google`, we:
     * 1. Parse the import specifiers to get font family names
     * 2. Find each font function call and extract its config
     * 3. Validate that all calls are statically analyzable
     * 4. Register extracted fonts in the registry
     * 5. Replace the function call with a static FontResult object
     */
    transform(code: string, id: string) {
      // Skip virtual modules and node_modules
      if (id.startsWith('\0') || id.includes('node_modules')) return null;

      const hasGoogleImport =
        code.includes('@timber/fonts/google') || code.includes('next/font/google');
      const hasLocalImport =
        code.includes('@timber/fonts/local') || code.includes('next/font/local');
      if (!hasGoogleImport && !hasLocalImport) return null;

      let transformedCode = code;

      // ── Google font transform ──────────────────────────────────────────
      if (hasGoogleImport) {
        const families = parseGoogleFontFamilies(code);
        if (families.size > 0) {
          const importedNames = [...families.keys()];

          const dynamicCall = detectDynamicFontCall(code, importedNames);
          if (dynamicCall) {
            this.error(
              `Font function calls must be statically analyzable. ` +
                `Found dynamic call: ${dynamicCall}. ` +
                `Pass a literal object with string/array values instead.`
            );
          }

          for (const [localName, family] of families) {
            const callPattern = new RegExp(
              `(?:const|let|var)\\s+(\\w+)\\s*=\\s*${localName}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`,
              'g'
            );

            let callMatch;
            while ((callMatch = callPattern.exec(code)) !== null) {
              const varName = callMatch[1];
              const configSource = callMatch[2];
              const fullMatch = callMatch[0];

              const config = extractFontConfig(`(${configSource})`);
              if (!config) {
                this.error(
                  `Could not statically analyze font config for ${family}. ` +
                    `Ensure all config values are string literals or arrays of string literals.`
                );
                return null;
              }

              const fontId = generateFontId(family, config);
              const className = familyToClassName(family);
              const fontStack = buildFontStack(family);
              const display = config.display ?? 'swap';

              const extracted: ExtractedFont = {
                id: fontId,
                family,
                provider: 'google',
                weights: normalizeToArray(config.weight),
                styles: normalizeStyleArray(config.style),
                subsets: config.subsets ?? ['latin'],
                display,
                variable: config.variable,
                className,
                fontFamily: fontStack,
                importer: id,
              };

              registry.set(fontId, extracted);

              const resultObj = config.variable
                ? `{ className: "${className}", style: { fontFamily: "${fontStack}" }, variable: "${config.variable}" }`
                : `{ className: "${className}", style: { fontFamily: "${fontStack}" } }`;

              const replacement = `const ${varName} = ${resultObj}`;
              transformedCode = transformedCode.replace(fullMatch, replacement);
            }
          }

          transformedCode = transformedCode.replace(
            /import\s*\{[^}]+\}\s*from\s*['"](?:@timber\/fonts\/google|next\/font\/google)['"];?\s*\n?/g,
            ''
          );
        }
      }

      // ── Local font transform ───────────────────────────────────────────
      if (hasLocalImport) {
        transformedCode = transformLocalFonts(
          transformedCode,
          code,
          id,
          registry,
          this.error.bind(this)
        );
      }

      if (transformedCode !== code) {
        return { code: transformedCode, map: null };
      }

      return null;
    },

    /**
     * Emit font files and metadata into the build output.
     *
     * For Google fonts: emits the downloaded, content-hashed woff2 files
     * and writes ManifestFontEntry arrays using real hashed URLs.
     *
     * For local fonts: emits entries using the source file paths.
     *
     * In dev mode the build manifest is null, so this is a no-op.
     */
    generateBundle() {
      // Emit cached Google Font files into the build output
      for (const cf of cachedFonts) {
        this.emitFile({
          type: 'asset',
          fileName: `_timber/fonts/${cf.hashedFilename}`,
          source: cf.data,
        });
      }

      if (!ctx.buildManifest) return;

      // Build a lookup from font family → cached files for manifest entries
      const cachedByFamily = new Map<string, CachedFont[]>();
      for (const cf of cachedFonts) {
        const key = cf.face.family.toLowerCase();
        const arr = cachedByFamily.get(key) ?? [];
        arr.push(cf);
        cachedByFamily.set(key, arr);
      }

      const fontsByImporter = new Map<string, ManifestFontEntry[]>();

      for (const font of registry.values()) {
        const entries = fontsByImporter.get(font.importer) ?? [];

        if (font.provider === 'local' && font.localSources) {
          // Local fonts: one entry per source file
          for (const src of font.localSources) {
            const filename = src.path.split('/').pop() ?? src.path;
            const format = inferFontFormat(src.path);
            entries.push({
              href: `/_timber/fonts/${filename}`,
              format,
              crossOrigin: 'anonymous',
            });
          }
        } else {
          // Google fonts: use real content-hashed URLs from cached downloads
          const familyKey = font.family.toLowerCase();
          const familyCached = cachedByFamily.get(familyKey) ?? [];
          for (const cf of familyCached) {
            entries.push({
              href: `/_timber/fonts/${cf.hashedFilename}`,
              format: 'woff2',
              crossOrigin: 'anonymous',
            });
          }
        }

        fontsByImporter.set(font.importer, entries);
      }

      // Normalize importer paths to be relative to project root (matching
      // how Vite's manifest.json keys work for css/js).
      for (const [importer, entries] of fontsByImporter) {
        const relativePath = importer.startsWith(ctx.root)
          ? importer.slice(ctx.root.length + 1)
          : importer;
        ctx.buildManifest.fonts[relativePath] = entries;
      }
    },
  };
}
