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
 * Reactivity: useParams() uses useSyncExternalStore so that components
 * in unchanged layouts (e.g., sidebar items) re-render atomically when
 * params change during client-side navigation. This matches the pattern
 * used by usePathname() and useSearchParams().
 *
 * All mutable state is delegated to client/state.ts for singleton guarantees.
 * See design/18-build-system.md §"Singleton State Registry"
 *
 * Design doc: design/09-typescript.md §"Typed Routes"
 */

import { useSyncExternalStore } from 'react';
import type { Routes } from '#/index.js';
import { getSsrData } from './ssr-data.js';
import { currentParams, _setCurrentParams, paramsListeners } from './state.js';

// ---------------------------------------------------------------------------
// Module-level subscribe/notify pattern — state lives in state.ts
// ---------------------------------------------------------------------------

/**
 * Subscribe to params changes. Called by useSyncExternalStore.
 * Exported for testing — not intended for direct use by app code.
 */
export function subscribe(callback: () => void): () => void {
  paramsListeners.add(callback);
  return () => paramsListeners.delete(callback);
}

/**
 * Get the current params snapshot (client).
 * Exported for testing — not intended for direct use by app code.
 */
export function getSnapshot(): Record<string, string | string[]> {
  return currentParams;
}

/**
 * Get the server-side params snapshot (SSR).
 * Falls back to the module-level currentParams if no SSR context
 * is available (shouldn't happen, but defensive).
 */
function getServerSnapshot(): Record<string, string | string[]> {
  return getSsrData()?.params ?? currentParams;
}

// ---------------------------------------------------------------------------
// Framework API — called by the segment router on each navigation
// ---------------------------------------------------------------------------

/**
 * Set the current route params WITHOUT notifying subscribers.
 * Called by the router before renderPayload() so that new components
 * in the RSC tree see the updated params via getSnapshot(), but
 * preserved layout components don't re-render prematurely with
 * {old tree, new params}.
 *
 * After the React render commits, the router calls notifyParamsListeners()
 * to trigger re-renders in preserved layouts that read useParams().
 *
 * On the client, the segment router calls this on each navigation.
 * During SSR, params are also available via getSsrData().params
 * (ALS-backed), but setCurrentParams is still called for the
 * module-level fallback path.
 */
export function setCurrentParams(params: Record<string, string | string[]>): void {
  _setCurrentParams(params);
}

/**
 * Notify all useSyncExternalStore subscribers that params have changed.
 * Called by the router AFTER renderPayload() so that preserved layout
 * components re-render only after the new tree is committed — producing
 * an atomic {new tree, new params} update instead of a stale
 * {old tree, new params} intermediate state.
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
 * During SSR, reads from the ALS-backed SSR data context to ensure
 * per-request isolation. On the client, subscribes to the module-level
 * params store via useSyncExternalStore.
 *
 * @overload Typed — when a known route path is passed, returns the
 *   exact params shape from the generated Routes interface.
 * @overload Fallback — returns the generic params record.
 */
export function useParams<R extends keyof Routes>(route: R): Routes[R]['params'];
export function useParams(route?: string): Record<string, string | string[]>;
export function useParams(_route?: string): Record<string, string | string[]> {
  // useSyncExternalStore handles both client and SSR:
  // - Client: calls getSnapshot() → reads currentParams from state.ts
  // - SSR: calls getServerSnapshot() → reads from ALS-backed getSsrData()
  //
  // We must always call the hook (Rules of Hooks — no conditional hook calls).
  // React picks the right snapshot function based on the environment.
  //
  // When called outside a React component (e.g., in test assertions),
  // useSyncExternalStore throws because there's no dispatcher. In that case,
  // fall back to reading the snapshot directly.
  try {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  } catch {
    // No React dispatcher available — return the best available snapshot.
    // This path is hit when useParams() is called outside a component,
    // e.g. in test assertions that verify the current params value.
    // Use getServerSnapshot() because it checks the ALS-backed SSR context
    // first (request-isolated), falling back to module-level currentParams
    // only when no SSR context exists (client-side / tests).
    return getServerSnapshot();
  }
}
