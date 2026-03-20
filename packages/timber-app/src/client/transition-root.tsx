/**
 * TransitionRoot — Wrapper component for transition-based rendering.
 *
 * Solves the "new boundary has no old content" problem for client-side
 * navigation. When React renders a completely new Suspense boundary via
 * root.render(), it shows the fallback immediately — root.render() is
 * always an urgent update regardless of startTransition.
 *
 * TransitionRoot holds the current element in React state. Navigation
 * updates call startTransition(() => setState(newElement)), which IS
 * a transition update. React keeps the old committed tree visible while
 * any new Suspense boundaries in the transition resolve.
 *
 * Also manages `pendingUrl` via `useOptimistic`. During a navigation
 * transition, the optimistic value (the target URL) shows immediately
 * while the transition is pending, and automatically reverts to null
 * when the transition commits. This ensures useLinkStatus and
 * useNavigationPending show the pending state immediately and clear
 * atomically with the new tree — same pattern Next.js uses with
 * useOptimistic per Link instance, adapted for timber's server-component
 * Link with global click delegation.
 *
 * See design/05-streaming.md §"deferSuspenseFor"
 * See design/19-client-navigation.md §"NavigationContext"
 */

import {
  useState,
  useOptimistic,
  useTransition,
  createElement,
  type ReactNode,
} from 'react';
import { PendingNavigationProvider } from './pending-navigation-context.js';

// ─── Module-level functions ──────────────────────────────────────

/**
 * Module-level reference to the state setter wrapped in startTransition.
 * Used for non-navigation renders (applyRevalidation, popstate replay).
 */
let _transitionRender: ((element: ReactNode) => void) | null = null;

/**
 * Module-level reference to the navigation transition function.
 * Wraps a full navigation (fetch + render) in a single startTransition
 * with useOptimistic for the pending URL.
 */
let _navigateTransition: ((
  pendingUrl: string,
  perform: () => Promise<ReactNode>,
) => Promise<void>) | null = null;

// ─── Component ───────────────────────────────────────────────────

/**
 * Root wrapper component that enables transition-based rendering.
 *
 * Renders PendingNavigationProvider around children for the pending URL
 * context. The DOM tree matches the server-rendered HTML during hydration
 * (the provider renders no extra DOM elements).
 *
 * Usage in browser-entry.ts:
 *   const rootEl = createElement(TransitionRoot, { initial: wrapped });
 *   reactRoot = hydrateRoot(document, rootEl);
 *
 * Subsequent navigations:
 *   navigateTransition(url, async () => { fetch; return wrappedElement; });
 *
 * Non-navigation renders:
 *   transitionRender(newWrappedElement);
 */
export function TransitionRoot({ initial }: { initial: ReactNode }): ReactNode {
  const [element, setElement] = useState<ReactNode>(initial);
  const [optimisticPendingUrl, setOptimisticPendingUrl] = useOptimistic<string | null>(null);
  // useTransition's startTransition (not the standalone import) creates an
  // action context that useOptimistic can track. The standalone startTransition
  // doesn't — optimistic values would never show.
  const [, startTransition] = useTransition();

  // Non-navigation render (revalidation, popstate cached replay).
  _transitionRender = (newElement: ReactNode) => {
    startTransition(() => {
      setElement(newElement);
    });
  };

  // Full navigation transition. The entire navigation (fetch + state updates)
  // runs inside startTransition. useOptimistic shows the pending URL immediately
  // (urgent) and reverts to null when the transition commits (atomic with new tree).
  _navigateTransition = (pendingUrl: string, perform: () => Promise<ReactNode>) => {
    return new Promise<void>((resolve, reject) => {
      startTransition(async () => {
        try {
          setOptimisticPendingUrl(pendingUrl);
          const newElement = await perform();
          setElement(newElement);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  };

  return createElement(PendingNavigationProvider, { value: optimisticPendingUrl }, element);
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Trigger a transition render for non-navigation updates.
 * React keeps the old committed tree visible while any new Suspense
 * boundaries in the update resolve.
 *
 * Used for: applyRevalidation, popstate replay with cached payload.
 */
export function transitionRender(element: ReactNode): void {
  if (_transitionRender) {
    _transitionRender(element);
  }
}

/**
 * Run a full navigation inside a React transition with optimistic pending URL.
 *
 * The `perform` callback runs inside `startTransition` — it should fetch the
 * RSC payload, update router state, and return the wrapped React element.
 * The pending URL shows immediately (useOptimistic urgent update) and reverts
 * to null when the transition commits (atomic with the new tree).
 *
 * Returns a Promise that resolves when the async work completes (note: the
 * React transition may not have committed yet, but all state updates are done).
 *
 * Used for: navigate(), refresh(), popstate with fetch.
 */
export function navigateTransition(
  pendingUrl: string,
  perform: () => Promise<ReactNode>,
): Promise<void> {
  if (_navigateTransition) {
    return _navigateTransition(pendingUrl, perform);
  }
  // Fallback: no TransitionRoot mounted (shouldn't happen in production)
  return perform().then(() => {});
}

/**
 * Check if the TransitionRoot is mounted and ready for renders.
 * Used by browser-entry.ts to guard against renders before hydration.
 */
export function isTransitionRootReady(): boolean {
  return _transitionRender !== null;
}
