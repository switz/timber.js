/**
 * Shared types for the timber-fonts pipeline.
 *
 * Used by the fonts plugin, CSS generator, fallback generator,
 * and the Google/local font providers.
 *
 * Design doc: 24-fonts.md
 */

/** Configuration passed to a Google font function (e.g. `Inter({ ... })`). */
export interface GoogleFontConfig {
  weight?: string | string[];
  subsets?: string[];
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  variable?: string;
  style?: string | string[];
  preload?: boolean;
}

/** A single local font source entry (multi-weight). */
export interface LocalFontSrc {
  path: string;
  weight?: string;
  style?: string;
}

/** Configuration passed to `localFont()`. */
export interface LocalFontConfig {
  src: string | LocalFontSrc[];
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  variable?: string;
  /** Override the font family name. Defaults to a generated name. */
  family?: string;
}

/**
 * The return value of a font function call.
 *
 * Matches the Next.js `next/font` return shape for compatibility.
 */
export interface FontResult {
  /** Scoped CSS class that applies font-family (e.g. `timber-font-inter`). */
  className: string;
  /** Inline style with the full font stack including fallbacks. */
  style: { fontFamily: string };
  /** CSS custom property name when `variable` is specified (e.g. `--font-sans`). */
  variable?: string;
}

/** Internal representation of a font extracted during static analysis. */
export interface ExtractedFont {
  /** Unique identifier for this font instance (e.g. `inter-400-normal-latin`). */
  id: string;
  /** The font family name (e.g. `Inter`). */
  family: string;
  /** Provider: 'google' or 'local'. */
  provider: 'google' | 'local';
  /** Weights requested (e.g. ['400', '700']). */
  weights: string[];
  /** Styles requested (e.g. ['normal', 'italic']). */
  styles: string[];
  /** Subsets requested (e.g. ['latin']). Google fonts only. */
  subsets: string[];
  /** font-display value. */
  display: string;
  /** CSS variable name (e.g. `--font-sans`). */
  variable?: string;
  /** Source file paths for local fonts. */
  localSources?: LocalFontSrc[];
  /** The module that imported this font (for segment association). */
  importer: string;
  /** Generated scoped class name. */
  className: string;
  /** Full font stack including fallback. */
  fontFamily: string;
}

/**
 * A single @font-face declaration's data (before CSS serialization).
 */
export interface FontFaceDescriptor {
  family: string;
  src: string;
  weight?: string;
  style?: string;
  display?: string;
  unicodeRange?: string;
}
