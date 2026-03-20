/**
 * usePathname() — client-side hook for reading the current pathname.
 *
 * Returns the pathname portion of the current URL (e.g. '/dashboard/settings').
 * Updates when client-side navigation changes the URL.
 *
 * On the client, reads from NavigationContext which is updated atomically
 * with the RSC tree render. This replaces the previous useSyncExternalStore
 * approach which only subscribed to popstate events — meaning usePathname()
 * did NOT re-render on forward navigation (pushState). The context approach
 * fixes this: pathname updates in the same render pass as the new tree.
 *
 * During SSR, reads the request pathname from the SSR ALS context
 * (populated by ssr-entry.ts) instead of window.location.
 *
 * Compatible with Next.js's `usePathname()` from `next/navigation`.
 */

import { getSsrData } from './ssr-data.js';
import { useNavigationContext } from './navigation-context.js';

/**
 * Read the current URL pathname.
 *
 * On the client, reads from NavigationContext (provided by
 * NavigationProvider in renderRoot). During SSR, reads from the
 * ALS-backed SSR data context. Falls back to window.location.pathname
 * when called outside a React component (e.g., in tests).
 */
export function usePathname(): string {
  // Try reading from NavigationContext (client-side, inside React tree).
  // During SSR, no NavigationProvider is mounted, so this returns null.
  try {
    const navContext = useNavigationContext();
    if (navContext !== null) {
      return navContext.pathname;
    }
  } catch {
    // No React dispatcher available (called outside a component).
    // Fall through to SSR/fallback below.
  }

  // SSR path: read from ALS-backed SSR data context.
  const ssrData = getSsrData();
  if (ssrData) return ssrData.pathname ?? '/';

  // Final fallback: window.location (tests, edge cases).
  if (typeof window !== 'undefined') return window.location.pathname;
  return '/';
}
