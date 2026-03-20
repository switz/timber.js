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
 * This is the client-side equivalent of deferSuspenseFor on the server:
 * the old content stays visible until the new content is ready, avoiding
 * flash-of-fallback during fast navigations.
 *
 * See design/05-streaming.md §"deferSuspenseFor"
 */

import { useState, startTransition, type ReactNode } from 'react';

// ─── Module-level render function ────────────────────────────────

/**
 * Module-level reference to the state setter wrapped in startTransition.
 * Set during TransitionRoot's render. This is safe because there is
 * exactly one TransitionRoot per application (the document root).
 */
let _transitionRender: ((element: ReactNode) => void) | null = null;

// ─── Component ───────────────────────────────────────────────────

/**
 * Root wrapper component that enables transition-based rendering.
 *
 * Renders no DOM elements — returns the current element directly.
 * This means the DOM tree matches the server-rendered HTML during
 * hydration (TransitionRoot is invisible to the DOM).
 *
 * Usage in browser-entry.ts:
 *   const rootEl = createElement(TransitionRoot, { initial: wrapped });
 *   reactRoot = hydrateRoot(document, rootEl);
 *
 * Subsequent navigations:
 *   transitionRender(newWrappedElement);
 */
export function TransitionRoot({ initial }: { initial: ReactNode }): ReactNode {
  const [element, setElement] = useState<ReactNode>(initial);

  // Update the module-level ref on every render so it always points
  // to the current component instance's setState.
  _transitionRender = (newElement: ReactNode) => {
    startTransition(() => {
      setElement(newElement);
    });
  };

  return element;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Trigger a transition render. React keeps the old committed tree
 * visible while any new Suspense boundaries in the update resolve.
 *
 * This is the function called by the router's renderRoot callback
 * instead of reactRoot.render() directly.
 *
 * Falls back to no-op if TransitionRoot hasn't mounted yet (shouldn't
 * happen in practice — TransitionRoot mounts during hydration).
 */
export function transitionRender(element: ReactNode): void {
  if (_transitionRender) {
    _transitionRender(element);
  }
}

/**
 * Check if the TransitionRoot is mounted and ready for renders.
 * Used by browser-entry.ts to guard against renders before hydration.
 */
export function isTransitionRootReady(): boolean {
  return _transitionRender !== null;
}
