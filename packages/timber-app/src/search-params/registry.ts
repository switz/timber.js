/**
 * Runtime registry for route-scoped search params definitions.
 *
 * When a route's modules load, the framework registers its search-params
 * definition here. useQueryStates('/route') resolves codecs from this map.
 *
 * Design doc: design/23-search-params.md §"Runtime: Registration at Route Load"
 */

import type { SearchParamsDefinition } from './create.js';

const registry = new Map<string, SearchParamsDefinition<any>>();

/**
 * Register a route's search params definition.
 * Called by the generated route manifest loader when a route's modules load.
 */
export function registerSearchParams(route: string, definition: SearchParamsDefinition<any>): void {
  registry.set(route, definition);
}

/**
 * Look up a route's search params definition.
 * Returns undefined if the route hasn't been loaded yet.
 */
export function getSearchParams(route: string): SearchParamsDefinition<any> | undefined {
  return registry.get(route);
}
