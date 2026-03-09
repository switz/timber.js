/**
 * useParams() — client-side hook for accessing route params.
 *
 * Returns the dynamic route parameters for the current URL.
 * When called with a route pattern argument, TypeScript narrows
 * the return type to the exact params shape for that route
 * (via codegen overloads in the generated route map).
 *
 * Design doc: design/09-typescript.md §"Typed Routes"
 */

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
 * it does not affect the runtime return value. Codegen generates
 * per-route overloads so that `useParams('/products/[id]')` returns
 * `{ id: string }` at the type level.
 */
export function useParams(
  _route?: string
): Record<string, string | string[]> {
  return currentParams;
}
