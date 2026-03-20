/**
 * useParams() — client-side hook for accessing route params.
 *
 * Returns the dynamic route parameters for the current URL.
 * When called with a route pattern argument, TypeScript narrows
 * the return type to the exact params shape for that route.
 *
 * Two layers of type narrowing work together:
 * 1. The generic overload here uses the Routes interface directly —
 *    `useParams<R>()` returns `Routes[R]['params']`.
 * 2. Build-time codegen generates per-route string-literal overloads
 *    in the .d.ts file for IDE autocomplete (see routing/codegen.ts).
 *
 * When the Routes interface is empty (no codegen yet), the generic
 * overload has `keyof Routes = never`, so only the fallback matches.
 *
 * During SSR, params are read from the ALS-backed SSR data context
 * (populated by ssr-entry.ts) to ensure correct per-request isolation
 * across concurrent requests with streaming Suspense.
 *
 * Reactivity: On the client, useParams() reads from NavigationContext
 * which is updated atomically with the RSC tree render. This replaces
 * the previous useSyncExternalStore approach that suffered from a
 * timing gap between tree render and store notification — causing
 * preserved layout components to briefly show stale active state.
 *
 * All mutable state is delegated to client/state.ts for singleton guarantees.
 * See design/18-build-system.md §"Singleton State Registry"
 *
 * Design doc: design/09-typescript.md §"Typed Routes"
 */

import type { Routes } from '#/index.js';
import { getSsrData } from './ssr-data.js';
import { currentParams, _setCurrentParams, paramsListeners } from './state.js';
import { useNavigationContext } from './navigation-context.js';

// ---------------------------------------------------------------------------
// Module-level subscribe/notify pattern — kept for backward compat and tests
// ---------------------------------------------------------------------------

/**
 * Subscribe to params changes.
 * Retained for backward compatibility with tests that verify the
 * subscribe/notify contract. On the client, useParams() reads from
 * NavigationContext instead.
 */
export function subscribe(callback: () => void): () => void {
  paramsListeners.add(callback);
  return () => paramsListeners.delete(callback);
}

/**
 * Get the current params snapshot (module-level fallback).
 * Used by tests and by the hook when called outside a React component.
 */
export function getSnapshot(): Record<string, string | string[]> {
  return currentParams;
}

// ---------------------------------------------------------------------------
// Framework API — called by the segment router on each navigation
// ---------------------------------------------------------------------------

/**
 * Set the current route params in the module-level store.
 *
 * Called by the router on each navigation. This updates the fallback
 * snapshot used by tests and by the hook when called outside a React
 * component (no NavigationContext available).
 *
 * On the client, the primary reactivity path is NavigationContext —
 * the router calls setNavigationState() then renderRoot() which wraps
 * the element in NavigationProvider. setCurrentParams is still called
 * for the module-level fallback.
 *
 * During SSR, params are also available via getSsrData().params
 * (ALS-backed).
 */
export function setCurrentParams(params: Record<string, string | string[]>): void {
  _setCurrentParams(params);
}

/**
 * Notify all legacy subscribers that params have changed.
 *
 * Retained for backward compatibility with tests. On the client,
 * the NavigationContext + renderRoot pattern replaces this — params
 * update atomically with the tree render, so explicit notification
 * is no longer needed.
 */
export function notifyParamsListeners(): void {
  for (const listener of paramsListeners) {
    listener();
  }
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

/**
 * Read the current route's dynamic params.
 *
 * The optional `_route` argument exists only for TypeScript narrowing —
 * it does not affect the runtime return value.
 *
 * On the client, reads from NavigationContext (provided by
 * NavigationProvider in renderRoot). This ensures params update
 * atomically with the RSC tree — no timing gap.
 *
 * During SSR, reads from the ALS-backed SSR data context to ensure
 * per-request isolation across concurrent requests with streaming Suspense.
 *
 * When called outside a React component (e.g., in test assertions),
 * falls back to the module-level snapshot.
 *
 * @overload Typed — when a known route path is passed, returns the
 *   exact params shape from the generated Routes interface.
 * @overload Fallback — returns the generic params record.
 */
export function useParams<R extends keyof Routes>(route: R): Routes[R]['params'];
export function useParams(route?: string): Record<string, string | string[]>;
export function useParams(_route?: string): Record<string, string | string[]> {
  // Try reading from NavigationContext (client-side, inside React tree).
  // During SSR, no NavigationProvider is mounted, so this returns null.
  // When called outside a React component, useContext throws — caught below.
  try {
    const navContext = useNavigationContext();
    if (navContext !== null) {
      return navContext.params;
    }
  } catch {
    // No React dispatcher available (called outside a component).
    // Fall through to module-level snapshot below.
  }

  // SSR path: read from ALS-backed SSR data context.
  // Falls back to module-level currentParams for tests.
  return getSsrData()?.params ?? currentParams;
}
