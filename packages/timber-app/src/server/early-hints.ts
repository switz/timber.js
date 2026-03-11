/**
 * 103 Early Hints utilities.
 *
 * Early Hints are sent before the final response to let the browser
 * start fetching critical resources (CSS, fonts, JS) while the server
 * is still rendering.
 *
 * The framework collects hints from two sources:
 * 1. Build manifest — CSS, fonts, and JS chunks known at route-match time
 * 2. ctx.earlyHints() — explicit hints added by middleware or route handlers
 *
 * Both are emitted as Link headers. Cloudflare CDN automatically converts
 * Link headers into 103 Early Hints responses.
 *
 * Design docs: 02-rendering-pipeline.md §"Early Hints (103)"
 */

import {
  collectRouteCss,
  collectRouteFonts,
  collectRouteModulepreloads,
} from './build-manifest.js';
import type { BuildManifest } from './build-manifest.js';

/** Minimal segment shape needed for early hint collection. */
interface SegmentWithFiles {
  layout?: { filePath: string };
  page?: { filePath: string };
}

// ─── EarlyHint type ───────────────────────────────────────────────────────

/**
 * A single Link header hint for 103 Early Hints.
 *
 * ```ts
 * ctx.earlyHints([
 *   { href: '/styles/critical.css', rel: 'preload', as: 'style' },
 *   { href: 'https://fonts.googleapis.com', rel: 'preconnect' },
 * ])
 * ```
 */
export interface EarlyHint {
  /** The resource URL (absolute or root-relative). */
  href: string;
  /** Link relation — `preload`, `modulepreload`, or `preconnect`. */
  rel: 'preload' | 'modulepreload' | 'preconnect';
  /** Resource type for `preload` hints (omit for `modulepreload` / `preconnect`). */
  as?: 'style' | 'script' | 'font' | 'image' | 'fetch' | 'document';
  /** Crossorigin attribute — required for font preloads per spec. */
  crossOrigin?: 'anonymous' | 'use-credentials';
  /** Fetch priority hint — `high`, `low`, or `auto`. */
  fetchPriority?: 'high' | 'low' | 'auto';
}

// ─── formatLinkHeader ─────────────────────────────────────────────────────

/**
 * Format a single EarlyHint as a Link header value.
 *
 * Examples:
 *   `</styles/root.css>; rel=preload; as=style`
 *   `</fonts/inter.woff2>; rel=preload; as=font; crossorigin=anonymous`
 *   `</_timber/client.js>; rel=modulepreload`
 *   `<https://fonts.googleapis.com>; rel=preconnect`
 */
export function formatLinkHeader(hint: EarlyHint): string {
  let value = `<${hint.href}>; rel=${hint.rel}`;
  if (hint.as !== undefined) value += `; as=${hint.as}`;
  if (hint.crossOrigin !== undefined) value += `; crossorigin=${hint.crossOrigin}`;
  if (hint.fetchPriority !== undefined) value += `; fetchpriority=${hint.fetchPriority}`;
  return value;
}

// ─── collectEarlyHintHeaders ──────────────────────────────────────────────

/**
 * Collect all Link header strings for a matched route's segment chain.
 *
 * Walks the build manifest to emit hints for:
 * - CSS stylesheets (rel=preload; as=style)
 * - Font assets (rel=preload; as=font; crossorigin)
 * - JS modulepreload hints (rel=modulepreload)
 *
 * Returns formatted Link header strings, deduplicated, root → leaf order.
 * Returns an empty array in dev mode (manifest is empty).
 */
export function collectEarlyHintHeaders(
  segments: SegmentWithFiles[],
  manifest: BuildManifest
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const add = (header: string) => {
    if (!seen.has(header)) {
      seen.add(header);
      result.push(header);
    }
  };

  // CSS — rel=preload; as=style
  for (const url of collectRouteCss(segments, manifest)) {
    add(formatLinkHeader({ href: url, rel: 'preload', as: 'style' }));
  }

  // Fonts — rel=preload; as=font; crossorigin (crossorigin required per spec)
  for (const font of collectRouteFonts(segments, manifest)) {
    add(
      formatLinkHeader({ href: font.href, rel: 'preload', as: 'font', crossOrigin: 'anonymous' })
    );
  }

  // JS chunks — rel=modulepreload
  for (const url of collectRouteModulepreloads(segments, manifest)) {
    add(formatLinkHeader({ href: url, rel: 'modulepreload' }));
  }

  return result;
}
