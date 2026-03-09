/**
 * Shim: next/font/google → stub
 *
 * timber.js font handling is implemented in the timber-fonts plugin.
 * This shim provides a no-op placeholder so imports of next/font/google
 * resolve without error. The real font pipeline is wired via the plugin.
 */

export interface FontConfig {
  weight?: string | string[];
  subsets?: string[];
  display?: string;
  variable?: string;
  style?: string | string[];
  preload?: boolean;
}

export interface FontResult {
  className: string;
  style: { fontFamily: string };
  variable?: string;
}

/**
 * Stub font loader. Returns empty class/style values.
 *
 * The timber-fonts plugin handles real font loading at build time.
 * This stub exists only so import resolution succeeds for libraries
 * that reference next/font/google.
 */
export default function fontLoader(_config?: FontConfig): FontResult {
  return {
    className: '',
    style: { fontFamily: '' },
  };
}
