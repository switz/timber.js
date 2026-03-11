/**
 * Config-level redirects and rewrites — evaluated after URL canonicalization,
 * before route matching.
 *
 * Supports :param placeholders in source and destination patterns.
 * Config redirects are for simple, declarative cases. For complex logic
 * (header-based conditions, async checks), use middleware.ts or proxy.ts.
 *
 * See design/07-routing.md
 */

import type { RedirectRule, RewriteRule } from '../index.js';

// ─── Types ───────────────────────────────────────────────────────────────

/** Result of matching a redirect rule. */
export interface RedirectMatch {
  type: 'redirect';
  destination: string;
  status: 307 | 308;
}

/** Result of matching a rewrite rule. */
export interface RewriteMatch {
  type: 'rewrite';
  destination: string;
}

/** Compiled redirect rule (pre-parsed for fast matching). */
interface CompiledRule {
  /** Regex compiled from the source pattern. */
  regex: RegExp;
  /** Param names in order of capture groups. */
  paramNames: string[];
  /** The destination pattern (with :param placeholders). */
  destination: string;
}

// ─── Pattern Compilation ─────────────────────────────────────────────────

/**
 * Compile a source pattern into a regex and param name list.
 *
 * Supported syntax:
 *   /old/:slug       → matches /old/anything, captures "slug"
 *   /docs/:a/:b      → matches /docs/x/y, captures "a" and "b"
 *   /old/:slug*      → matches /old/a/b/c, captures "slug" as "a/b/c"
 *   /exact           → matches only /exact
 */
function compilePattern(source: string): CompiledRule['regex'] & { paramNames: string[] } {
  const paramNames: string[] = [];

  // Escape regex special chars (except : which we use for params)
  const regexStr = source
    .split('/')
    .map((segment) => {
      if (!segment) return '';

      // Catch-all param: :name*
      const catchAllMatch = segment.match(/^:(\w+)\*$/);
      if (catchAllMatch) {
        paramNames.push(catchAllMatch[1]);
        return '(.+)';
      }

      // Named param: :name
      const paramMatch = segment.match(/^:(\w+)$/);
      if (paramMatch) {
        paramNames.push(paramMatch[1]);
        return '([^/]+)';
      }

      // Static segment — escape regex special chars
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  const regex = new RegExp(`^${regexStr}$`) as RegExp & { paramNames: string[] };
  regex.paramNames = paramNames;
  return regex;
}

/**
 * Interpolate captured params into a destination pattern.
 *
 * /new/:slug with { slug: "hello" } → /new/hello
 */
function interpolateDestination(destination: string, params: Record<string, string>): string {
  return destination.replace(/:(\w+)\*?/g, (_, name) => params[name] ?? `:${name}`);
}

// ─── Compiled Matcher ────────────────────────────────────────────────────

interface CompiledRedirect extends CompiledRule {
  status: 307 | 308;
}

/**
 * Create a redirect/rewrite matcher from config rules.
 *
 * Rules are compiled once at startup and matched on each request.
 * Returns a function that takes a canonical pathname and returns
 * a RedirectMatch, RewriteMatch, or null.
 */
export function createRedirectMatcher(
  redirects: RedirectRule[] = [],
  rewrites: RewriteRule[] = []
): (pathname: string) => RedirectMatch | RewriteMatch | null {
  // Compile rules once at startup
  const compiledRedirects: CompiledRedirect[] = redirects.map((rule) => {
    const compiled = compilePattern(rule.source);
    return {
      regex: compiled,
      paramNames: compiled.paramNames,
      destination: rule.destination,
      status: rule.permanent ? 308 : 307,
    };
  });

  const compiledRewrites: CompiledRule[] = rewrites.map((rule) => {
    const compiled = compilePattern(rule.source);
    return {
      regex: compiled,
      paramNames: compiled.paramNames,
      destination: rule.destination,
    };
  });

  return (pathname: string): RedirectMatch | RewriteMatch | null => {
    // Redirects take priority over rewrites (checked first)
    for (const rule of compiledRedirects) {
      const match = pathname.match(rule.regex);
      if (match) {
        const params: Record<string, string> = {};
        rule.paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
        return {
          type: 'redirect',
          destination: interpolateDestination(rule.destination, params),
          status: rule.status,
        };
      }
    }

    for (const rule of compiledRewrites) {
      const match = pathname.match(rule.regex);
      if (match) {
        const params: Record<string, string> = {};
        rule.paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
        return {
          type: 'rewrite',
          destination: interpolateDestination(rule.destination, params),
        };
      }
    }

    return null;
  };
}
