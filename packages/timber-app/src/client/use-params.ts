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
 * Design doc: design/09-typescript.md §"Typed Routes"
 */

import { useSyncExternalStore } from 'react';
import type { Routes } from '#/index.js';
import { getSsrData } from './ssr-data.js';

// ---------------------------------------------------------------------------
// Module-level state + subscribe/notify pattern
// ---------------------------------------------------------------------------

// The current params snapshot. Replaced (not mutated) on each navigation
// so that React's Object.is check on the snapshot detects changes.
let currentParams: Record<string, string | string[]> = {};

// Listeners notified when currentParams changes.
const listeners = new Set<() => void>();

/**
 * Subscribe to params changes. Called by useSyncExternalStore.
 * Exported for testing — not intended for direct use by app code.
 */
export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
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
 * Set the current route params. Called by the framework internals
 * during navigation — not intended for direct use by app code.
 *
 * On the client, the segment router calls this on each navigation.
 * During SSR, params are also available via getSsrData().params
 * (ALS-backed), but setCurrentParams is still called for the
 * module-level fallback path.
 *
 * After mutation, all useSyncExternalStore subscribers are notified
 * so that every mounted useParams() consumer re-renders in the same
 * React commit — even components in unchanged layouts.
 */
export function setCurrentParams(params: Record<string, string | string[]>): void {
  currentParams = params;
  for (const listener of listeners) {
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
  // During SSR, read from the ALS-backed SSR data context.
  // This ensures correct params even for components inside Suspense
  // boundaries that resolve asynchronously across concurrent requests.
  const ssrData = getSsrData();
  if (ssrData) {
    return ssrData.params;
  }

  // useSyncExternalStore requires a React dispatcher (i.e., must be called
  // inside a component render). When called outside a component (e.g., in
  // tests or setup code), fall back to reading the snapshot directly.
  // This mirrors React's own behavior — hooks only work during rendering.
  try {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  } catch {
    // No React dispatcher available — return the snapshot directly.
    // This path is hit when useParams() is called outside a component,
    // e.g. in test assertions that verify the current params value.
    return getSnapshot();
  }
}
