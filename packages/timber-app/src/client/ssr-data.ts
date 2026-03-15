/**
 * SSR Data — per-request state for client hooks during server-side rendering.
 *
 * RSC and SSR are separate Vite module graphs (see design/18-build-system.md),
 * so the RSC environment's request-context ALS is not visible to SSR modules.
 * This module provides setter/getter functions that ssr-entry.ts uses to
 * populate per-request data before React's synchronous shell render.
 *
 * Module-level state is safe here because React's renderToReadableStream
 * renders the shell synchronously — the framework sets values before render,
 * React reads them during render, and the next request sets its own values
 * before its render. This matches the pattern used by useParams/setCurrentParams.
 *
 * IMPORTANT: This module must NOT import node:async_hooks or any Node.js-only
 * APIs, as it's imported by 'use client' hooks that are bundled for the browser.
 */

// ─── Types ────────────────────────────────────────────────────────

export interface SsrData {
  /** The request's URL pathname (e.g. '/dashboard/settings') */
  pathname: string;
  /** The request's search params as a plain record */
  searchParams: Record<string, string>;
  /** The request's cookies as name→value pairs */
  cookies: Map<string, string>;
}

// ─── Per-Request State ────────────────────────────────────────────

let currentSsrData: SsrData | undefined;

/**
 * Set the SSR data for the current request. Called by ssr-entry.ts before
 * React's synchronous shell render so that client hooks return correct
 * request data during server-side rendering.
 */
export function setSsrData(data: SsrData): void {
  currentSsrData = data;
}

/**
 * Clear the SSR data after rendering completes. Called by ssr-entry.ts
 * to prevent stale data from leaking to subsequent requests.
 */
export function clearSsrData(): void {
  currentSsrData = undefined;
}

/**
 * Read the current request's SSR data. Returns undefined when called
 * outside an SSR render (i.e. on the client after hydration).
 *
 * Used by client hooks' server snapshot functions.
 */
export function getSsrData(): SsrData | undefined {
  return currentSsrData;
}
