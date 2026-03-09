// Link component — client-side navigation with progressive enhancement
// See design/19-client-navigation.md § Progressive Enhancement
//
// Without JavaScript, <Link> renders as a plain <a> tag — standard browser
// navigation. With JavaScript, the client runtime intercepts clicks on links
// marked with data-timber-link, fetches RSC payloads, and reconciles the DOM.

import type { AnchorHTMLAttributes, ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────────────

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  /** Prefetch the RSC payload on hover */
  prefetch?: boolean;
  /**
   * Scroll to top on navigation. Defaults to true.
   * Set to false for tabbed interfaces where content changes within a fixed layout.
   */
  scroll?: boolean;
  children?: ReactNode;
}

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
  props: Pick<LinkProps, 'href' | 'prefetch' | 'scroll'>
): LinkOutputProps {
  validateLinkHref(props.href);

  const output: LinkOutputProps = { href: props.href };
  const internal = isInternalHref(props.href);

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
 */
export function Link({ href, prefetch, scroll, children, ...rest }: LinkProps) {
  const linkProps = buildLinkProps({ href, prefetch, scroll });

  return (
    <a {...rest} {...linkProps}>
      {children}
    </a>
  );
}
