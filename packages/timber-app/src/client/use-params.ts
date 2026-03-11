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
 * Design doc: design/09-typescript.md §"Typed Routes"
 */

import type { Routes } from '../index.js';

// The current params are set by the framework during navigation.
// In production, this is populated by the segment router when it
// processes an RSC payload and extracts the matched route params.
let currentParams: Record<string, string | string[]> = {};

/**
 * Set the current route params. Called by the framework internals
 * during navigation — not intended for direct use by app code.
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
 * @overload Typed — when a known route path is passed, returns the
 *   exact params shape from the generated Routes interface.
 * @overload Fallback — returns the generic params record.
 */
export function useParams<R extends keyof Routes>(route: R): Routes[R]['params'];
export function useParams(route?: string): Record<string, string | string[]>;
export function useParams(_route?: string): Record<string, string | string[]> {
  return currentParams;
}
