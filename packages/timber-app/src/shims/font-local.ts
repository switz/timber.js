/**
 * Shim: next/font/local → stub
 *
 * timber.js local font handling is implemented in the timber-fonts plugin.
 * This shim provides a no-op placeholder so imports of next/font/local
 * resolve without error. The real font pipeline is wired via the plugin.
 *
 * Design doc: 24-fonts.md §"Shim Updates"
 */

export interface LocalFontConfig {
  src: string | Array<{ path: string; weight?: string; style?: string }>;
  display?: string;
  variable?: string;
  family?: string;
}

export interface FontResult {
  className: string;
  style: { fontFamily: string };
  variable?: string;
}

/**
 * Stub local font loader. Returns empty class/style values.
 *
 * The timber-fonts plugin handles real font loading at build time.
 * This stub exists only so import resolution succeeds for libraries
 * that reference next/font/local.
 */
export default function localFont(_config?: LocalFontConfig): FontResult {
  return {
    className: '',
    style: { fontFamily: '' },
  };
}
