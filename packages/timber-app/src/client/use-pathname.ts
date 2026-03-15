/**
 * usePathname() — client-side hook for reading the current pathname.
 *
 * Returns the pathname portion of the current URL (e.g. '/dashboard/settings').
 * Updates when client-side navigation changes the URL.
 *
 * This is a thin wrapper over window.location.pathname, provided for
 * Next.js API compatibility (libraries like nuqs import usePathname
 * from next/navigation).
 *
 * During SSR, reads the request pathname from the SSR ALS context
 * (populated by ssr-entry.ts) instead of window.location.
 */

import { useSyncExternalStore } from 'react';
import { getSsrData } from './ssr-data.js';

function getPathname(): string {
  if (typeof window !== 'undefined') return window.location.pathname;
  return getSsrData()?.pathname ?? '/';
}

function getServerPathname(): string {
  return getSsrData()?.pathname ?? '/';
}

function subscribe(callback: () => void): () => void {
  // Listen for popstate (back/forward) and timber's custom navigation events.
  // pushState/replaceState don't fire popstate, but timber's router calls
  // onPendingChange listeners after navigation — components re-render
  // naturally via React's tree update from the new RSC payload.
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

/**
 * Read the current URL pathname.
 *
 * Compatible with Next.js's `usePathname()` from `next/navigation`.
 */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname, getServerPathname);
}
