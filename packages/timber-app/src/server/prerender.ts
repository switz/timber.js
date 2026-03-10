/**
 * Pre-rendering types and utilities.
 *
 * A `prerender.ts` file in a route segment signals the framework to
 * pre-render the route's shell at build time. This module defines the
 * types that a user exports from `prerender.ts` and utilities for
 * loading and validating those exports.
 *
 * Design doc: design/15-future-prerendering.md
 */

import { parseCacheLife } from '../plugins/cache-transform.js';

// ---------------------------------------------------------------------------
// Types — user-facing exports from prerender.ts
// ---------------------------------------------------------------------------

/**
 * The shape of a prerender.ts module's exports.
 *
 * ```ts
 * // app/docs/[slug]/prerender.ts
 * export async function generateParams() {
 *   return docs.map(d => ({ slug: d.slug }))
 * }
 * export const ttl = '1h'
 * export const tags = ['docs']
 * ```
 */
export interface PrerenderConfig {
  /**
   * Generate the set of params to pre-render at build time.
   * Required for dynamic segments (`[param]`).
   * Optional for static segments (the single URL is pre-rendered automatically).
   */
  generateParams?: () => Promise<Record<string, string>[]> | Record<string, string>[];

  /**
   * How long the pre-rendered shell is considered fresh.
   * Accepts duration strings ('30s', '5m', '1h', '2d', '1w') or seconds as a number.
   * Default: Infinity (cache until explicit invalidation).
   */
  ttl?: string | number;

  /**
   * Invalidation tags. Calling `revalidateTag('docs')` purges all
   * pre-rendered shells with that tag.
   */
  tags?: string[];

  /**
   * Fallback strategy for dynamic routes without `generateParams`.
   * Only valid in `output: 'static'` mode.
   * - `'shell'`: emit a single pre-rendered shell that serves as client-side fallback
   */
  fallback?: 'shell';
}

// ---------------------------------------------------------------------------
// Parsed prerender config — framework-internal, with TTL resolved to seconds
// ---------------------------------------------------------------------------

export interface ResolvedPrerenderConfig {
  /** TTL in seconds. Infinity if not set. */
  ttlSeconds: number;
  /** Invalidation tags */
  tags: string[];
  /** The generateParams function, if provided */
  generateParams?: () => Promise<Record<string, string>[]> | Record<string, string>[];
  /** Fallback strategy */
  fallback?: 'shell';
}

/**
 * Resolve raw prerender.ts exports into a normalized config.
 *
 * Validates:
 * - `ttl` is a valid duration string or number
 * - `tags` is an array of strings
 * - `fallback` is 'shell' or undefined
 */
export function resolvePrerenderConfig(raw: PrerenderConfig): ResolvedPrerenderConfig {
  const ttlSeconds = raw.ttl != null ? parseCacheLife(raw.ttl) : Infinity;

  const tags = raw.tags ?? [];
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
    throw new Error(
      `prerender.ts: tags must be an array of strings. Got: ${JSON.stringify(raw.tags)}`
    );
  }

  if (raw.fallback != null && raw.fallback !== 'shell') {
    throw new Error(
      `prerender.ts: fallback must be 'shell' or omitted. Got: ${JSON.stringify(raw.fallback)}`
    );
  }

  return {
    ttlSeconds,
    tags,
    generateParams: raw.generateParams,
    fallback: raw.fallback,
  };
}

// ---------------------------------------------------------------------------
// Build diagnostics
// ---------------------------------------------------------------------------

export interface PrerenderDiagnostic {
  type: 'DYNAMIC_SEGMENT_NO_PARAMS';
  segmentPath: string;
  message: string;
}

/**
 * Check if a dynamic segment has `generateParams` when prerender.ts is present.
 * If not, emit a diagnostic — the route falls back to SSR.
 */
export function checkDynamicSegmentParams(
  segmentPath: string,
  isDynamic: boolean,
  hasGenerateParams: boolean,
  fallback?: 'shell'
): PrerenderDiagnostic | null {
  if (!isDynamic) return null;
  if (hasGenerateParams) return null;
  if (fallback === 'shell') return null;

  return {
    type: 'DYNAMIC_SEGMENT_NO_PARAMS',
    segmentPath,
    message:
      `Dynamic segment "${segmentPath}" has prerender.ts but no generateParams(). ` +
      `The route will fall back to SSR at request time. ` +
      `Add generateParams() to pre-render specific param values, ` +
      `or set fallback: 'shell' (static mode only) for a client-side fallback shell.`,
  };
}
