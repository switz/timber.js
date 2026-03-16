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
 * Design doc: design/09-typescript.md §"Typed Routes"
 */

import type { Routes } from '#/index.js';
import { getSsrData } from './ssr-data.js';

// The current params are set by the framework during navigation.
// In production, this is populated by the segment router when it
// processes an RSC payload and extracts the matched route params.
// During SSR, params are read from getSsrData() instead (ALS-backed).
let currentParams: Record<string, string | string[]> = {};

/**
 * Set the current route params. Called by the framework internals
 * during navigation — not intended for direct use by app code.
 *
 * On the client, the segment router calls this on each navigation.
 * During SSR, params are also available via getSsrData().params
 * (ALS-backed), but setCurrentParams is still called for the
 * module-level fallback path.
 */
export function setCurrentParams(params: Record<string, string | string[]>): void {
  currentParams = params;
}

/**
 * Read the current route's dynamic params.
 *
 * The optional `_route` argument exists only for TypeScript narrowing —
 * it does not affect the runtime return value.
 *
 * During SSR, reads from the ALS-backed SSR data context to ensure
 * per-request isolation. On the client, reads from module-level state
 * (set by the segment router on each navigation).
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
  return currentParams;
}
