/**
 * Link click interception and hover prefetch for SPA navigation.
 *
 * Handles click events on <a data-timber-link> and mouseenter events
 * on <a data-timber-prefetch> for client-side navigation.
 *
 * Extracted from browser-entry.ts to keep files under 500 lines.
 *
 * See design/19-client-navigation.md
 */

import type { RouterInstance } from '@timber-js/app/client';
import { ON_NAVIGATE_KEY } from './link-navigate-interceptor.js';

// ─── Link Click Interception ─────────────────────────────────────

/**
 * Handle click events on timber links. Intercepts clicks on <a> elements
 * marked with data-timber-link and triggers SPA navigation instead of
 * a full page load.
 *
 * Passes through to default browser behavior when:
 * - Modified keys are held (Ctrl, Meta, Shift, Alt) — open in new tab
 * - The click is not the primary button
 * - The link has a target attribute (e.g., target="_blank")
 * - The link has a download attribute
 */
export function handleLinkClick(event: MouseEvent, router: RouterInstance): void {
  // Only intercept primary clicks without modifier keys
  if (event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.defaultPrevented) return;

  // Find the closest <a> ancestor with data-timber-link
  const anchor = (event.target as Element).closest?.(
    'a[data-timber-link]'
  ) as HTMLAnchorElement | null;
  if (!anchor) return;

  // Don't intercept links that should open externally
  if (anchor.target && anchor.target !== '_self') return;
  if (anchor.hasAttribute('download')) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  // Prevent default navigation
  event.preventDefault();

  // Call onNavigate if registered on this anchor (via LinkNavigateInterceptor).
  // If the handler calls preventDefault(), skip the default SPA navigation —
  // the caller is responsible for navigating (e.g. via router.push()).
  const onNavigate = anchor[ON_NAVIGATE_KEY];
  if (onNavigate) {
    let prevented = false;
    onNavigate({
      preventDefault: () => {
        prevented = true;
      },
    });
    if (prevented) return;
  }

  // Check scroll preference from data attribute
  const scroll = anchor.getAttribute('data-timber-scroll') !== 'false';

  // Trigger SPA navigation
  void router.navigate(href, { scroll });
}

// ─── Prefetch on Hover ───────────────────────────────────────────

/**
 * Handle mouseenter events on prefetch-enabled links. When the user
 * hovers over <a data-timber-prefetch>, the RSC payload is fetched
 * and cached for near-instant navigation.
 *
 * See design/19-client-navigation.md §"Prefetch Cache"
 */
export function handleLinkHover(event: MouseEvent, router: RouterInstance): void {
  const anchor = (event.target as Element).closest?.(
    'a[data-timber-prefetch]'
  ) as HTMLAnchorElement | null;
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  router.prefetch(href);
}
