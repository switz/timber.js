/**
 * useRouter() — client-side hook for programmatic navigation.
 *
 * Returns a router instance with push, replace, refresh, back, forward,
 * and prefetch methods. Compatible with Next.js's `useRouter()` from
 * `next/navigation` (App Router).
 *
 * This wraps timber's internal RouterInstance in the Next.js-compatible
 * AppRouterInstance shape that ecosystem libraries expect.
 */

import { getRouter } from './router-ref.js';

export interface AppRouterInstance {
  /** Navigate to a URL, pushing a new history entry */
  push(href: string, options?: { scroll?: boolean }): void;
  /** Navigate to a URL, replacing the current history entry */
  replace(href: string, options?: { scroll?: boolean }): void;
  /** Refresh the current page (re-fetch RSC payload) */
  refresh(): void;
  /** Navigate back in history */
  back(): void;
  /** Navigate forward in history */
  forward(): void;
  /** Prefetch an RSC payload for a URL */
  prefetch(href: string): void;
}

/**
 * Get a router instance for programmatic navigation.
 *
 * Compatible with Next.js's `useRouter()` from `next/navigation`.
 */
export function useRouter(): AppRouterInstance {
  const router = getRouter();

  return {
    push(href: string, options?: { scroll?: boolean }) {
      void router.navigate(href, { scroll: options?.scroll });
    },
    replace(href: string, options?: { scroll?: boolean }) {
      void router.navigate(href, { scroll: options?.scroll, replace: true });
    },
    refresh() {
      void router.refresh();
    },
    back() {
      window.history.back();
    },
    forward() {
      window.history.forward();
    },
    prefetch(href: string) {
      router.prefetch(href);
    },
  };
}
