/**
 * useSearchParams() — client-side hook for reading URL search params.
 *
 * Returns a read-only URLSearchParams instance reflecting the current
 * URL's query string. Updates when client-side navigation changes the URL.
 *
 * This is a thin wrapper over window.location.search, provided for
 * Next.js API compatibility (libraries like nuqs import useSearchParams
 * from next/navigation).
 *
 * Unlike Next.js's ReadonlyURLSearchParams, this returns a standard
 * URLSearchParams. Mutation methods (set, delete, append) work on the
 * local copy but do NOT affect the URL — use the router or nuqs for that.
 */

import { useSyncExternalStore } from 'react';

function getSearch(): string {
  return typeof window !== 'undefined' ? window.location.search : '';
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

// Cache the last search string and its parsed URLSearchParams to avoid
// creating a new object on every render when the URL hasn't changed.
let cachedSearch = '';
let cachedParams = new URLSearchParams();

function getSearchParams(): URLSearchParams {
  const search = getSearch();
  if (search !== cachedSearch) {
    cachedSearch = search;
    cachedParams = new URLSearchParams(search);
  }
  return cachedParams;
}

function getServerSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

/**
 * Read the current URL search params.
 *
 * Compatible with Next.js's `useSearchParams()` from `next/navigation`.
 */
export function useSearchParams(): URLSearchParams {
  // useSyncExternalStore needs a primitive snapshot for comparison.
  // We use the raw search string as the snapshot, then return the
  // parsed URLSearchParams.
  useSyncExternalStore(subscribe, getSearch, () => '');
  return typeof window !== 'undefined' ? getSearchParams() : getServerSearchParams();
}
