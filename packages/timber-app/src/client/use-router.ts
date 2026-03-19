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
 * Methods lazily resolve the global router when invoked (during user
 * interaction) rather than capturing it at render time. This is critical
 * because during hydration, React synchronously executes component render
 * functions *before* the router is bootstrapped in browser-entry.ts.
 * If we eagerly captured the router during render, components would get
 * the SSR_NOOP_ROUTER and be stuck with silent no-ops forever.
 *
 * Returns safe no-ops during SSR (typeof window === 'undefined').
 */
export function useRouter(): AppRouterInstance {
  // SSR guard — on the server there's no router and no window.
  if (typeof window === 'undefined') {
    return SSR_NOOP_ROUTER;
  }

  return {
    push(href: string, options?: { scroll?: boolean }) {
      const router = getRouter();
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
      const router = getRouter();
      startTransition(async () => {
        await router.navigate(href, { scroll: options?.scroll, replace: true });
      });
    },
    refresh() {
      const router = getRouter();
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
      const router = getRouter();
      router.prefetch(href);
    },
  };
}
