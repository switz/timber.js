/**
 * useRouter() — client-side hook for programmatic navigation.
 *
 * Returns a router instance with push, replace, refresh, back, forward,
 * and prefetch methods. Compatible with Next.js's `useRouter()` from
 * `next/navigation` (App Router).
 *
 * This wraps timber's internal RouterInstance in the Next.js-compatible
 * AppRouterInstance shape that ecosystem libraries expect.
 *
 * NOTE: Unlike Next.js, these methods do NOT wrap navigation in
 * startTransition. In Next.js, router state is React state (useReducer)
 * so startTransition defers the update and provides isPending tracking.
 * In timber, navigation calls reactRoot.render() which is a root-level
 * render — startTransition has no effect on root renders.
 *
 * Navigation state (params, pathname) is delivered atomically via
 * NavigationContext embedded in the element tree passed to
 * reactRoot.render(). See design/19-client-navigation.md §"NavigationContext".
 *
 * For loading UI during navigation, use:
 * - useLinkStatus()          — per-link pending indicator (inside <Link>)
 * - useNavigationPending()   — global navigation pending state
 */

import { getRouterOrNull } from './router-ref.js';

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
 *
 * Methods lazily resolve the global router when invoked (during user
 * interaction) rather than capturing it at render time. This is critical
 * because during hydration, React synchronously executes component render
 * functions *before* the router is bootstrapped in browser-entry.ts.
 * If we eagerly captured the router during render, components would get
 * a null reference and be stuck with silent no-ops forever.
 *
 * Returns safe no-ops during SSR or before bootstrap. The `typeof window`
 * check is insufficient because Vite's client SSR environment defines
 * `window`, so we use a try/catch on getRouter() — but only at method
 * invocation time, not at render time.
 */
export function useRouter(): AppRouterInstance {
  return {
    push(href: string, options?: { scroll?: boolean }) {
      const router = getRouterOrNull();
      if (!router) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[timber] useRouter().push() called but router is not initialized. This is a bug — please report it.');
        }
        return;
      }
      void router.navigate(href, { scroll: options?.scroll });
    },
    replace(href: string, options?: { scroll?: boolean }) {
      const router = getRouterOrNull();
      if (!router) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[timber] useRouter().replace() called but router is not initialized.');
        }
        return;
      }
      void router.navigate(href, { scroll: options?.scroll, replace: true });
    },
    refresh() {
      const router = getRouterOrNull();
      if (!router) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[timber] useRouter().refresh() called but router is not initialized.');
        }
        return;
      }
      void router.refresh();
    },
    back() {
      if (typeof window !== 'undefined') window.history.back();
    },
    forward() {
      if (typeof window !== 'undefined') window.history.forward();
    },
    prefetch(href: string) {
      const router = getRouterOrNull();
      if (!router) return; // Silent — prefetch failure is non-fatal
      router.prefetch(href);
    },
  };
}
