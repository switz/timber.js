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
 * - Local font file resolution (timber-60p)
 *
 * Design doc: 24-fonts.md
 */

import type { Plugin } from 'vite';
import type { PluginContext } from '../index.js';
import type { ExtractedFont, GoogleFontConfig } from '../fonts/types.js';
import { generateVariableClass, generateFontFamilyClass } from '../fonts/css.js';
import { generateFallbackCss, buildFontStack } from '../fonts/fallbacks.js';

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
 */
export function extractFontConfig(
  callSource: string
): GoogleFontConfig | null {
  // Match the object literal inside the function call
  const objMatch = callSource.match(/\(\s*(\{[\s\S]*?\})\s*\)/);
  if (!objMatch) return null;

  const objStr = objMatch[1];

  try {
    // Parse individual properties from the object literal.
    // We do this with regex rather than eval for security.
    const config: GoogleFontConfig = {};

    // Extract `subsets` array
    const subsetsMatch = objStr.match(/subsets\s*:\s*\[([^\]]*)\]/);
    if (subsetsMatch) {
      config.subsets = subsetsMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean);
    }

    // Extract `weight` — string or array
    const weightArrayMatch = objStr.match(/weight\s*:\s*\[([^\]]*)\]/);
    if (weightArrayMatch) {
      config.weight = weightArrayMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean);
    } else {
      const weightStrMatch = objStr.match(/weight\s*:\s*['"]([^'"]+)['"]/);
      if (weightStrMatch) config.weight = weightStrMatch[1];
    }

    // Extract `display`
    const displayMatch = objStr.match(/display\s*:\s*['"]([^'"]+)['"]/);
    if (displayMatch) config.display = displayMatch[1] as GoogleFontConfig['display'];

    // Extract `variable`
    const variableMatch = objStr.match(/variable\s*:\s*['"]([^'"]+)['"]/);
    if (variableMatch) config.variable = variableMatch[1];

    // Extract `style` — string or array
    const styleArrayMatch = objStr.match(/style\s*:\s*\[([^\]]*)\]/);
    if (styleArrayMatch) {
      config.style = styleArrayMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean);
    } else {
      const styleStrMatch = objStr.match(/style\s*:\s*['"]([^'"]+)['"]/);
      if (styleStrMatch) config.style = styleStrMatch[1];
    }

    // Extract `preload`
    const preloadMatch = objStr.match(/preload\s*:\s*(true|false)/);
    if (preloadMatch) config.preload = preloadMatch[1] === 'true';

    return config;
  } catch {
    return null;
  }
}

/**
 * Detect if a source file contains dynamic/computed font function calls
 * that cannot be statically analyzed.
 *
 * Returns the offending expression if found, null if all calls are static.
 */
export function detectDynamicFontCall(source: string, importedNames: string[]): string | null {
  for (const name of importedNames) {
    // Check for calls with variable arguments: FontName(someVar)
    const callPattern = new RegExp(`${name}\\s*\\(\\s*([^{)][^)]*?)\\s*\\)`, 'g');
    let match;
    while ((match = callPattern.exec(source)) !== null) {
      const arg = match[1].trim();
      // If the argument isn't an object literal, it's dynamic
      if (arg && !arg.startsWith('{')) {
        return `${name}(${arg})`;
      }
    }
  }
  return null;
}

/**
 * Parse import specifiers from a source file that imports from @timber/fonts/google.
 *
 * Returns the list of imported font names (e.g. ['Inter', 'JetBrains_Mono']).
 */
export function parseGoogleFontImports(source: string): string[] {
  const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"]@timber\/fonts\/google['"]/g;
  const names: string[] = [];

  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const specifiers = match[1].split(',').map((s) => s.trim()).filter(Boolean);
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
  const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"]@timber\/fonts\/google['"]/g;
  const families = new Map<string, string>();

  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const specifiers = match[1].split(',').map((s) => s.trim()).filter(Boolean);
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
 * Create the timber-fonts Vite plugin.
 */
export function timberFonts(_ctx: PluginContext): Plugin {
  const registry: FontRegistry = new Map();

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

      // Check if the file imports from @timber/fonts/google
      const hasGoogleImport = code.includes('@timber/fonts/google');
      if (!hasGoogleImport) return null;

      const families = parseGoogleFontFamilies(code);
      if (families.size === 0) return null;

      const importedNames = [...families.keys()];

      // Check for dynamic calls that can't be statically analyzed
      const dynamicCall = detectDynamicFontCall(code, importedNames);
      if (dynamicCall) {
        this.error(
          `Font function calls must be statically analyzable. ` +
          `Found dynamic call: ${dynamicCall}. ` +
          `Pass a literal object with string/array values instead.`
        );
      }

      let transformedCode = code;

      for (const [localName, family] of families) {
        // Find all calls: FontName({ ... })
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

          // Build the static replacement
          const resultObj = config.variable
            ? `{ className: "${className}", style: { fontFamily: "${fontStack}" }, variable: "${config.variable}" }`
            : `{ className: "${className}", style: { fontFamily: "${fontStack}" } }`;

          const replacement = `const ${varName} = ${resultObj}`;
          transformedCode = transformedCode.replace(fullMatch, replacement);
        }
      }

      // Remove the import statement (the virtual module is no longer needed
      // after transform replaces all calls with static objects)
      transformedCode = transformedCode.replace(
        /import\s*\{[^}]+\}\s*from\s*['"]@timber\/fonts\/google['"];?\s*\n?/g,
        ''
      );

      if (transformedCode !== code) {
        return { code: transformedCode, map: null };
      }

      return null;
    },
  };
}
