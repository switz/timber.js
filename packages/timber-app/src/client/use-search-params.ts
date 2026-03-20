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
 *
 * During SSR, reads the request search params from the SSR ALS context
 * (populated by ssr-entry.ts) instead of window.location.
 *
 * All mutable state is delegated to client/state.ts for singleton guarantees.
 * See design/18-build-system.md §"Singleton State Registry"
 */

import { useSyncExternalStore } from 'react';
import { getSsrData } from './ssr-data.js';
import { cachedSearch, cachedSearchParams, _setCachedSearch } from './state.js';

function getSearch(): string {
  if (typeof window !== 'undefined') return window.location.search;
  const data = getSsrData();
  if (!data) return '';
  const sp = new URLSearchParams(data.searchParams);
  const str = sp.toString();
  return str ? `?${str}` : '';
}

function getServerSearch(): string {
  const data = getSsrData();
  if (!data) return '';
  const sp = new URLSearchParams(data.searchParams);
  const str = sp.toString();
  return str ? `?${str}` : '';
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

// Cache the last search string and its parsed URLSearchParams to avoid
// creating a new object on every render when the URL hasn't changed.
// State lives in client/state.ts for singleton guarantees.

function getSearchParams(): URLSearchParams {
  const search = getSearch();
  if (search !== cachedSearch) {
    const params = new URLSearchParams(search);
    _setCachedSearch(search, params);
    return params;
  }
  return cachedSearchParams;
}

function getServerSearchParams(): URLSearchParams {
  const data = getSsrData();
  return data ? new URLSearchParams(data.searchParams) : new URLSearchParams();
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
  useSyncExternalStore(subscribe, getSearch, getServerSearch);
  return typeof window !== 'undefined' ? getSearchParams() : getServerSearchParams();
}
