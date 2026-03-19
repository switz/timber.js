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

import { startTransition } from 'react';
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

/** No-op router returned during SSR or before bootstrap. All methods are safe no-ops. */
const SSR_NOOP_ROUTER: AppRouterInstance = {
  push() {},
  replace() {},
  refresh() {},
  back() {},
  forward() {},
  prefetch() {},
};

/**
 * Get a router instance for programmatic navigation.
 *
 * Compatible with Next.js's `useRouter()` from `next/navigation`.
 *
 * Returns a no-op router during SSR or before the client router is bootstrapped,
 * so components that call useRouter() at the function level (e.g. TransitionLink)
 * do not crash during server-side rendering.
 */
export function useRouter(): AppRouterInstance {
  let router;
  try {
    router = getRouter();
  } catch {
    // Router not yet bootstrapped — SSR or early client render before bootstrap().
    return SSR_NOOP_ROUTER;
  }

  return {
    push(href: string, options?: { scroll?: boolean }) {
      // Wrap in startTransition so React 19 tracks the async navigation.
      // React 19's startTransition accepts async callbacks — it keeps
      // isPending=true until the returned promise resolves. This means
      // useTransition's isPending reflects the full RSC fetch + render
      // lifecycle when wrapping router.push() in startTransition.
      startTransition(async () => {
        await router.navigate(href, { scroll: options?.scroll });
      });
    },
    replace(href: string, options?: { scroll?: boolean }) {
      startTransition(async () => {
        await router.navigate(href, { scroll: options?.scroll, replace: true });
      });
    },
    refresh() {
      startTransition(async () => {
        await router.refresh();
      });
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
