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
 * Also manages `pendingUrl` as React state with an urgent/transition split:
 * - Navigation START: `setPendingUrl(url)` is an urgent update — React
 *   commits it before the next paint, showing the spinner immediately.
 * - Navigation END: `setPendingUrl(null)` is inside `startTransition`
 *   alongside `setElement(newTree)` — both commit atomically, so the
 *   spinner disappears in the same frame as the new content appears.
 *
 * See design/05-streaming.md §"deferSuspenseFor"
 * See design/19-client-navigation.md §"NavigationContext"
 */

import { useState, useTransition, createElement, Fragment, type ReactNode } from 'react';
import { PendingNavigationProvider } from './navigation-context.js';
import { TopLoader, type TopLoaderConfig } from './top-loader.js';

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
let _navigateTransition:
  | ((pendingUrl: string, perform: () => Promise<ReactNode>) => Promise<void>)
  | null = null;

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
export function TransitionRoot({ initial, topLoaderConfig }: { initial: ReactNode; topLoaderConfig?: TopLoaderConfig }): ReactNode {
  const [element, setElement] = useState<ReactNode>(initial);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Non-navigation render (revalidation, popstate cached replay).
  _transitionRender = (newElement: ReactNode) => {
    startTransition(() => {
      setElement(newElement);
    });
  };

  // Full navigation transition.
  // setPendingUrl(url) is an URGENT update — React commits it before the next
  // paint, so the pending spinner appears immediately when navigation starts.
  // Inside startTransition: the async fetch + setElement + setPendingUrl(null)
  // are deferred. When the transition commits, the new tree and pendingUrl=null
  // both apply in the same React commit — making the pending→active transition
  // atomic (no frame where pending is false but the old tree is still visible).
  _navigateTransition = (url: string, perform: () => Promise<ReactNode>) => {
    // Urgent: show pending state immediately
    setPendingUrl(url);

    return new Promise<void>((resolve, reject) => {
      startTransition(async () => {
        try {
          const newElement = await perform();
          setElement(newElement);
          // Clear pending inside the transition — commits atomically with new tree
          setPendingUrl(null);
          resolve();
        } catch (err) {
          // Clear pending on error too
          setPendingUrl(null);
          reject(err);
        }
      });
    });
  };

  // Inject TopLoader alongside the element tree inside PendingNavigationProvider.
  // The TopLoader reads pendingUrl from context to show/hide the progress bar.
  // It is rendered only when not explicitly disabled via config.
  const showTopLoader = topLoaderConfig?.enabled !== false;
  const children = showTopLoader
    ? createElement(Fragment, null, createElement(TopLoader, { config: topLoaderConfig }), element)
    : element;
  return createElement(PendingNavigationProvider, { value: pendingUrl }, children);
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
  perform: () => Promise<ReactNode>
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
