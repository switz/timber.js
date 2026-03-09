/**
 * useQueryStates — client-side hook for URL-synced search params.
 *
 * Wraps nuqs to provide URL synchronization with React 19 transitions.
 * shallow: false by default — changing params triggers a server RSC navigation.
 *
 * Design doc: design/09-typescript.md §"useQueryStates"
 * Design doc: design/05-search-params.md §"useQueryStates"
 */

import { useSyncExternalStore, useCallback, useRef } from 'react';
import type {
  SearchParamCodec,
  SearchParamsDefinition,
  SetParams,
  SetParamsOptions,
  QueryStatesOptions,
} from '../search-params/create.js';

// ─── Types ───────────────────────────────────────────────────────

/** Dependencies injected for testability. */
export interface UseQueryStatesDeps {
  /** Get the current URL search string (e.g. "?page=2&q=boots") */
  getSearch(): string;
  /** Subscribe to URL changes. Returns an unsubscribe function. */
  subscribe(callback: () => void): () => void;
  /** Push a new URL to the browser history */
  pushState(url: string): void;
  /** Replace the current URL in the browser history */
  replaceState(url: string): void;
  /** Trigger a server RSC navigation for the given URL */
  navigate(url: string): void;
}

// Default browser deps — used in production
let _deps: UseQueryStatesDeps | undefined;

/**
 * Inject platform dependencies. Called once at app hydration.
 * In tests, call this with mock dependencies before using useQueryStates.
 */
export function setQueryStatesDeps(deps: UseQueryStatesDeps): void {
  _deps = deps;
}

function getDeps(): UseQueryStatesDeps {
  if (!_deps) {
    throw new Error(
      'useQueryStates: platform dependencies not initialized. ' +
        'Call setQueryStatesDeps() during app hydration.'
    );
  }
  return _deps;
}

// ─── Hook ────────────────────────────────────────────────────────

/**
 * Read and write typed search params from/to the URL.
 *
 * Usage:
 * ```ts
 * // Via a SearchParamsDefinition
 * const [params, setParams] = definition.useQueryStates()
 *
 * // Standalone with inline codecs
 * const [params, setParams] = useQueryStates({
 *   page: fromSchema(z.coerce.number().int().min(1).default(1)),
 * })
 * ```
 *
 * Options:
 * - shallow: false (default) — triggers server RSC navigation
 * - scroll: true (default) — scroll to top on URL change
 * - history: 'push' (default) — push vs replace state
 */
export function useQueryStates<T extends Record<string, unknown>>(
  codecs: { [K in keyof T]: SearchParamCodec<T[K]> },
  options?: QueryStatesOptions
): [T, SetParams<T>] {
  const deps = getDeps();

  // Parse the current URL search params using the codecs
  const search = useSyncExternalStore(
    deps.subscribe,
    deps.getSearch,
    // Server snapshot — empty search on SSR
    () => ''
  );

  const codecsRef = useRef(codecs);
  codecsRef.current = codecs;

  // Parse the current search string into typed values
  const parsed = parseSearch(search, codecs);

  const setParams: SetParams<T> = useCallback(
    (values: Partial<T>, setOptions?: SetParamsOptions) => {
      const mergedOptions = { ...options, ...setOptions };
      const shallow = mergedOptions.shallow ?? false;
      const scroll = mergedOptions.scroll !== false;
      const history = mergedOptions.history ?? 'push';

      // Read current search params, merge with new values, serialize
      const currentSearch = deps.getSearch();
      const currentParsed = parseSearch(currentSearch, codecsRef.current);
      const merged = { ...currentParsed, ...values } as T;
      const qs = serializeParams(merged, codecsRef.current);

      // Build new URL preserving the pathname
      const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
      const newUrl = qs ? `${pathname}?${qs}` : pathname;

      // Update the URL
      if (history === 'replace') {
        deps.replaceState(newUrl);
      } else {
        deps.pushState(newUrl);
      }

      // Trigger server navigation if not shallow
      if (!shallow) {
        deps.navigate(newUrl);
      } else if (scroll) {
        // For shallow updates, scroll to top if requested
        if (typeof window !== 'undefined') {
          window.scrollTo(0, 0);
        }
      }
    },
    [deps, options]
  );

  return [parsed, setParams];
}

// ─── Internal helpers ────────────────────────────────────────────

/**
 * Parse a URL search string using the provided codecs.
 */
function parseSearch<T extends Record<string, unknown>>(
  search: string,
  codecs: { [K in keyof T]: SearchParamCodec<T[K]> }
): T {
  const usp = new URLSearchParams(search);
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(codecs)) {
    const values = usp.getAll(key);
    let raw: string | string[] | undefined;
    if (values.length === 0) {
      raw = undefined;
    } else if (values.length === 1) {
      raw = values[0];
    } else {
      raw = values;
    }
    result[key] = (codecs[key as keyof T] as SearchParamCodec<unknown>).parse(raw);
  }

  return result as T;
}

/**
 * Serialize typed values to a query string (no leading '?'),
 * omitting values that match the codec's default.
 */
function serializeParams<T extends Record<string, unknown>>(
  values: T,
  codecs: { [K in keyof T]: SearchParamCodec<T[K]> }
): string {
  const parts: string[] = [];

  for (const key of Object.keys(codecs)) {
    const codec = codecs[key as keyof T] as SearchParamCodec<unknown>;
    const serialized = codec.serialize(values[key as keyof T] as unknown);

    // Omit if serialized matches the default
    const defaultSerialized = codec.serialize(codec.parse(undefined));
    if (serialized === defaultSerialized) continue;
    if (serialized === null) continue;

    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(serialized)}`);
  }

  return parts.join('&');
}

/**
 * Create a useQueryStates binding for a SearchParamsDefinition.
 * This is used internally by SearchParamsDefinition.useQueryStates().
 */
export function bindUseQueryStates<T extends Record<string, unknown>>(
  definition: SearchParamsDefinition<T>
): (options?: QueryStatesOptions) => [T, SetParams<T>] {
  return (options?: QueryStatesOptions) => {
    return useQueryStates<T>(definition.codecs, options);
  };
}
