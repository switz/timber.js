/**
 * Interception route matching for the request pipeline.
 *
 * Matches target URLs against interception rewrites to support the
 * modal route pattern (soft navigation intercepts).
 *
 * Extracted from pipeline.ts to keep files under 500 lines.
 *
 * See design/07-routing.md §"Intercepting Routes"
 */

/** Result of a successful interception match. */
export interface InterceptionMatchResult {
  /** The pathname to re-match (the source/intercepting route's parent). */
  sourcePathname: string;
}

/**
 * Check if an intercepting route applies for this soft navigation.
 *
 * Matches the target pathname against interception rewrites, constrained
 * by the source URL (X-Timber-URL header — where the user navigates FROM).
 *
 * Returns the source pathname to re-match if interception applies, or null.
 */
export function findInterceptionMatch(
  targetPathname: string,
  sourceUrl: string,
  rewrites: import('#/routing/interception.js').InterceptionRewrite[]
): InterceptionMatchResult | null {
  for (const rewrite of rewrites) {
    // Check if the source URL starts with the intercepting prefix
    if (!sourceUrl.startsWith(rewrite.interceptingPrefix)) continue;

    // Check if the target URL matches the intercepted pattern.
    // Dynamic segments in the pattern match any single URL segment.
    if (pathnameMatchesPattern(targetPathname, rewrite.interceptedPattern)) {
      return { sourcePathname: rewrite.interceptingPrefix };
    }
  }
  return null;
}

/**
 * Check if a pathname matches a URL pattern with dynamic segments.
 *
 * Supports [param] (single segment) and [...param] (one or more segments).
 * Static segments must match exactly.
 */
export function pathnameMatchesPattern(pathname: string, pattern: string): boolean {
  const pathParts = pathname === '/' ? [] : pathname.slice(1).split('/');
  const patternParts = pattern === '/' ? [] : pattern.slice(1).split('/');

  let pi = 0;
  for (let i = 0; i < patternParts.length; i++) {
    const segment = patternParts[i];

    // Catch-all: [...param] or [[...param]] — matches rest of URL
    if (segment.startsWith('[...') || segment.startsWith('[[...')) {
      return pi < pathParts.length || segment.startsWith('[[...');
    }

    // Dynamic: [param] — matches any single segment
    if (segment.startsWith('[') && segment.endsWith(']')) {
      if (pi >= pathParts.length) return false;
      pi++;
      continue;
    }

    // Static — must match exactly
    if (pi >= pathParts.length || pathParts[pi] !== segment) return false;
    pi++;
  }

  return pi === pathParts.length;
}
