/**
 * Fallback shim for `next/font/google` → `@timber/fonts/google`.
 *
 * At build time, the timber-fonts plugin's transform hook replaces font
 * function calls with static FontResult objects containing real class names
 * and font stacks. This file serves two purposes:
 *
 * 1. **TypeScript resolution** — provides types for IDEs and `tsc` outside
 *    of Vite's module graph (where the virtual module handles it).
 * 2. **Runtime fallback** — returns empty className/fontFamily values when
 *    the plugin hasn't processed a call (e.g. in tests or non-Vite environments).
 *
 * The shim resolution path (`next/font/google` → `\0@timber/fonts/google`)
 * is unchanged — this file is NOT on that resolution path. It exists as a
 * physical module for direct imports and type re-exports.
 *
 * Design doc: 24-fonts.md, "Next.js Font Compatibility"
 */

import type { GoogleFontConfig, FontResult } from '@/fonts/types.js';

export type { GoogleFontConfig, FontResult };

/**
 * Create a stub FontResult with empty values.
 *
 * The timber-fonts plugin replaces these calls at build time with real
 * class names and font stacks. This stub ensures code that imports
 * font functions outside of the build pipeline (tests, type-checking)
 * gets a valid FontResult shape without runtime errors.
 */
function createStubFontResult(config?: GoogleFontConfig): FontResult {
  return {
    className: '',
    style: { fontFamily: '' },
    variable: config?.variable,
  };
}

/**
 * Generic font loader — accepts any font name, returns a stub FontResult.
 *
 * Named exports like `Inter`, `Roboto`, etc. are generated dynamically
 * by the virtual module at build time. This function provides a catch-all
 * for non-Vite contexts.
 */
export function createFont(_family: string, config?: GoogleFontConfig): FontResult {
  return createStubFontResult(config);
}

// Common Google Font exports for TypeScript autocomplete.
// These are stubs — the virtual module and transform hook provide real values.
export const Inter = (config?: GoogleFontConfig): FontResult => createStubFontResult(config);
export const Roboto = (config?: GoogleFontConfig): FontResult => createStubFontResult(config);
export const Open_Sans = (config?: GoogleFontConfig): FontResult => createStubFontResult(config);
export const Lato = (config?: GoogleFontConfig): FontResult => createStubFontResult(config);
export const Montserrat = (config?: GoogleFontConfig): FontResult => createStubFontResult(config);
export const Poppins = (config?: GoogleFontConfig): FontResult => createStubFontResult(config);
export const Geist = (config?: GoogleFontConfig): FontResult => createStubFontResult(config);
export const Geist_Mono = (config?: GoogleFontConfig): FontResult => createStubFontResult(config);
export const JetBrains_Mono = (config?: GoogleFontConfig): FontResult =>
  createStubFontResult(config);
export const Source_Code_Pro = (config?: GoogleFontConfig): FontResult =>
  createStubFontResult(config);
export const Playfair_Display = (config?: GoogleFontConfig): FontResult =>
  createStubFontResult(config);
export const Merriweather = (config?: GoogleFontConfig): FontResult =>
  createStubFontResult(config);
