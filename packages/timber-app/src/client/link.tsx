// Link component — client-side navigation with progressive enhancement
// See design/19-client-navigation.md § Progressive Enhancement
//
// Without JavaScript, <Link> renders as a plain <a> tag — standard browser
// navigation. With JavaScript, the client runtime intercepts clicks on links
// marked with data-timber-link, fetches RSC payloads, and reconciles the DOM.
//
// Typed Link: design/09-typescript.md §"Typed Link"
// - href validated against known routes (via codegen overloads, not runtime)
// - params prop typed per-route, URL interpolated at runtime
// - searchParams prop serialized via SearchParamsDefinition
// - params and fully-resolved string href are mutually exclusive
// - searchParams and inline query string are mutually exclusive

import type { AnchorHTMLAttributes, ReactNode } from 'react';
import type { SearchParamsDefinition } from '#/search-params/create.js';
import type { OnNavigateHandler } from './link-navigate-interceptor.js';
import { LinkNavigateInterceptor } from './link-navigate-interceptor.js';
import { LinkStatusProvider } from './link-status-provider.js';

// ─── Types ───────────────────────────────────────────────────────

/**
 * Base props shared by all Link variants.
 */
interface LinkBaseProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Prefetch the RSC payload on hover */
  prefetch?: boolean;
  /**
   * Scroll to top on navigation. Defaults to true.
   * Set to false for tabbed interfaces where content changes within a fixed layout.
   */
  scroll?: boolean;
  /**
   * Called before client-side navigation commits. Call `e.preventDefault()`
   * to cancel the default navigation — the caller is then responsible for
   * navigating (e.g. via `router.push()`).
   *
   * Only fires for client-side SPA navigations, not full page loads.
   * Has no effect during SSR.
   */
  onNavigate?: OnNavigateHandler;
  children?: ReactNode;
}

/**
 * Link with a fully-resolved string href.
 * When using a string href with params already interpolated,
 * the params prop is not available.
 */
export interface LinkPropsWithHref extends LinkBaseProps {
  href: string;
  params?: never;
  /**
   * Typed search params — serialized via the route's SearchParamsDefinition.
   * Mutually exclusive with an inline query string in href.
   */
  searchParams?: {
    definition: SearchParamsDefinition<Record<string, unknown>>;
    values: Record<string, unknown>;
  };
}

/**
 * Link with a route pattern + params for interpolation.
 * e.g. <Link href="/products/[id]" params={{ id: "123" }}>
 *      <Link href="/products/[id]" params={{ id: 123 }}>
 */
export interface LinkPropsWithParams extends LinkBaseProps {
  /** Route pattern with dynamic segments (e.g. "/products/[id]") */
  href: string;
  /**
   * Dynamic segment values to interpolate into the href.
   * Single dynamic segments accept string | number (numbers are stringified).
   * Catch-all segments accept string[].
   */
  params: Record<string, string | number | string[]>;
  /**
   * Typed search params — serialized via the route's SearchParamsDefinition.
   */
  searchParams?: {
    definition: SearchParamsDefinition<Record<string, unknown>>;
    values: Record<string, unknown>;
  };
}

export type LinkProps = LinkPropsWithHref | LinkPropsWithParams;

// ─── Dangerous URL Scheme Detection ──────────────────────────────

/**
 * Reject dangerous URL schemes that could execute script.
 * Security: design/13-security.md § Link scheme injection (test #9)
 */
const DANGEROUS_SCHEMES = /^\s*(javascript|data|vbscript):/i;

export function validateLinkHref(href: string): void {
  if (DANGEROUS_SCHEMES.test(href)) {
    throw new Error(
      `<Link> received a dangerous href: "${href}". ` +
        'javascript:, data:, and vbscript: URLs are not allowed.'
    );
  }
}

// ─── Internal Link Detection ─────────────────────────────────────

/** Returns true if the href is an internal path (not an external URL) */
function isInternalHref(href: string): boolean {
  // Relative paths, root-relative paths, and hash links are internal
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('?')) {
    return true;
  }
  // Anything with a protocol scheme is external
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return false;
  }
  // Bare relative paths (e.g., "dashboard") are internal
  return true;
}

// ─── URL Interpolation ──────────────────────────────────────────

/**
 * Interpolate dynamic segments in a route pattern with actual values.
 * e.g. interpolateParams("/products/[id]", { id: "123" }) → "/products/123"
 *
 * Supports:
 * - [param]          → single segment
 * - [...param]       → catch-all (joined with /)
 * - [[...param]]     → optional catch-all (omitted if undefined/empty)
 */
export function interpolateParams(
  pattern: string,
  params: Record<string, string | number | string[]>
): string {
  return (
    pattern
      .replace(
        /\[\[\.\.\.(\w+)\]\]|\[\.\.\.(\w+)\]|\[(\w+)\]/g,
        (_match, optionalCatchAll, catchAll, single) => {
          if (optionalCatchAll) {
            const value = params[optionalCatchAll];
            if (value === undefined || (Array.isArray(value) && value.length === 0)) {
              return '';
            }
            const segments = Array.isArray(value) ? value : [value];
            return segments.map(encodeURIComponent).join('/');
          }

          if (catchAll) {
            const value = params[catchAll];
            if (value === undefined) {
              throw new Error(
                `<Link> missing required catch-all param "${catchAll}" for pattern "${pattern}".`
              );
            }
            const segments = Array.isArray(value) ? value : [value];
            if (segments.length === 0) {
              throw new Error(
                `<Link> catch-all param "${catchAll}" must have at least one segment for pattern "${pattern}".`
              );
            }
            return segments.map(encodeURIComponent).join('/');
          }

          // single dynamic segment
          const value = params[single];
          if (value === undefined) {
            throw new Error(`<Link> missing required param "${single}" for pattern "${pattern}".`);
          }
          if (Array.isArray(value)) {
            throw new Error(
              `<Link> param "${single}" expected a string but received an array for pattern "${pattern}".`
            );
          }
          // Accept numbers — coerce to string for URL interpolation
          return encodeURIComponent(String(value));
        }
      )
      // Clean up trailing slash from empty optional catch-all
      .replace(/\/+$/, '') || '/'
  );
}

// ─── Resolve Href ───────────────────────────────────────────────

/**
 * Resolve the final href string from Link props.
 *
 * Handles:
 * - params interpolation into route patterns
 * - searchParams serialization via SearchParamsDefinition
 * - Validation that searchParams and inline query strings are exclusive
 */
export function resolveHref(
  href: string,
  params?: Record<string, string | number | string[]>,
  searchParams?: {
    definition: SearchParamsDefinition<Record<string, unknown>>;
    values: Record<string, unknown>;
  }
): string {
  let resolvedPath = href;

  // Interpolate params if provided
  if (params) {
    resolvedPath = interpolateParams(href, params);
  }

  // Serialize searchParams if provided
  if (searchParams) {
    // Validate: searchParams prop and inline query string are mutually exclusive
    if (resolvedPath.includes('?')) {
      throw new Error(
        '<Link> received both a searchParams prop and a query string in href. ' +
          'These are mutually exclusive — use one or the other.'
      );
    }

    const qs = searchParams.definition.serialize(searchParams.values);
    if (qs) {
      resolvedPath = `${resolvedPath}?${qs}`;
    }
  }

  return resolvedPath;
}

// ─── Build Props ─────────────────────────────────────────────────

interface LinkOutputProps {
  'href': string;
  'data-timber-link'?: boolean;
  'data-timber-prefetch'?: boolean;
  'data-timber-scroll'?: string;
}

/**
 * Build the HTML attributes for a Link. Separated from the component
 * for testability — the component just spreads these onto an <a>.
 */
export function buildLinkProps(
  props: Pick<LinkPropsWithHref, 'href' | 'prefetch' | 'scroll'> & {
    params?: Record<string, string | number | string[]>;
    searchParams?: {
      definition: SearchParamsDefinition<Record<string, unknown>>;
      values: Record<string, unknown>;
    };
  }
): LinkOutputProps {
  const resolvedHref = resolveHref(props.href, props.params, props.searchParams);

  validateLinkHref(resolvedHref);

  const output: LinkOutputProps = { href: resolvedHref };
  const internal = isInternalHref(resolvedHref);

  if (internal) {
    output['data-timber-link'] = true;

    if (props.prefetch) {
      output['data-timber-prefetch'] = true;
    }

    if (props.scroll === false) {
      output['data-timber-scroll'] = 'false';
    }
  }

  return output;
}

// ─── Link Component ──────────────────────────────────────────────

/**
 * Navigation link with progressive enhancement.
 *
 * Renders as a plain `<a>` tag — works without JavaScript. When the client
 * runtime is active, it intercepts clicks on links marked with
 * `data-timber-link` to perform RSC-based client navigation.
 *
 * Supports typed routes via codegen overloads. At runtime:
 * - `params` prop interpolates dynamic segments in the href pattern
 * - `searchParams` prop serializes query parameters via a SearchParamsDefinition
 */
export function Link({
  href,
  prefetch,
  scroll,
  params,
  searchParams,
  onNavigate,
  children,
  ...rest
}: LinkProps) {
  const linkProps = buildLinkProps({ href, prefetch, scroll, params, searchParams });

  const inner = <LinkStatusProvider href={linkProps.href}>{children}</LinkStatusProvider>;

  return (
    <a {...rest} {...linkProps}>
      {onNavigate ? (
        <LinkNavigateInterceptor onNavigate={onNavigate}>{inner}</LinkNavigateInterceptor>
      ) : (
        inner
      )}
    </a>
  );
}
