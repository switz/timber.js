/**
 * SSR Data — per-request state for client hooks during server-side rendering.
 *
 * RSC and SSR are separate Vite module graphs (see design/18-build-system.md),
 * so the RSC environment's request-context ALS is not visible to SSR modules.
 * This module provides getter/setter functions that ssr-entry.ts uses to
 * populate per-request data for React's render.
 *
 * Request isolation: On the server, ssr-entry.ts registers an ALS-backed
 * provider via registerSsrDataProvider(). getSsrData() reads from the ALS
 * store, ensuring correct per-request data even when Suspense boundaries
 * resolve asynchronously across concurrent requests. The module-level
 * setSsrData/clearSsrData functions are kept as a fallback for tests
 * and environments without ALS.
 *
 * IMPORTANT: This module must NOT import node:async_hooks or any Node.js-only
 * APIs, as it's imported by 'use client' hooks that are bundled for the browser.
 * The ALS instance lives in ssr-entry.ts (server-only); this module only holds
 * a reference to the provider function.
 *
 * All mutable state is delegated to client/state.ts for singleton guarantees.
 * See design/18-build-system.md §"Singleton State Registry"
 */

import {
  ssrDataProvider,
  currentSsrData,
  _setSsrDataProvider,
  _setCurrentSsrData,
} from './state.js';

// ─── Types ────────────────────────────────────────────────────────

export interface SsrData {
  /** The request's URL pathname (e.g. '/dashboard/settings') */
  pathname: string;
  /** The request's search params as a plain record */
  searchParams: Record<string, string>;
  /** The request's cookies as name→value pairs */
  cookies: Map<string, string>;
  /** The request's route params (e.g. { id: '123' }) */
  params: Record<string, string | string[]>;
  /**
   * Mutable reference to NavContext for error boundary → RSC communication.
   * When TimberErrorBoundary catches a DenySignal, it sets
   * `_navContext._denyHandledByBoundary = true` to prevent the RSC entry
   * from promoting the denial to page-level. See LOCAL-298.
   */
  _navContext?: { _denyHandledByBoundary?: boolean };
}

// ─── ALS-Backed Provider ─────────────────────────────────────────
//
// Server-side code (ssr-entry.ts) registers a provider that reads
// from AsyncLocalStorage. This avoids importing node:async_hooks
// in this browser-bundled module.
//
// Module singleton guarantee: In Vite's SSR environment, both
// ssr-entry.ts (via #/client/ssr-data.js) and client component hooks
// (via @timber-js/app/client) must resolve to the SAME module instance
// of this file. The timber-shims plugin ensures this by remapping
// @timber-js/app/client → src/client/index.ts in the SSR environment.
// Without this remap, @timber-js/app/client resolves to dist/ (via
// package.json exports), creating a split where registerSsrDataProvider
// writes to one instance but getSsrData reads from another.
// See timber-shims plugin resolveId for details.

/**
 * Register an ALS-backed SSR data provider. Called once at module load
 * by ssr-entry.ts to wire up per-request data via AsyncLocalStorage.
 *
 * When registered, getSsrData() reads from the provider (ALS store)
 * instead of module-level state, ensuring correct isolation for
 * concurrent requests with streaming Suspense.
 */
export function registerSsrDataProvider(provider: () => SsrData | undefined): void {
  _setSsrDataProvider(provider);
}

// ─── Module-Level Fallback ────────────────────────────────────────
//
// Used by tests and as a fallback when no ALS provider is registered.

/**
 * Set the SSR data for the current request via module-level state.
 *
 * In production, ssr-entry.ts uses ALS (runWithSsrData) instead.
 * This function is retained for tests and as a fallback.
 */
export function setSsrData(data: SsrData): void {
  _setCurrentSsrData(data);
}

/**
 * Clear the SSR data after rendering completes.
 *
 * In production, ALS scope handles cleanup automatically.
 * This function is retained for tests and as a fallback.
 */
export function clearSsrData(): void {
  _setCurrentSsrData(undefined);
}

/**
 * Read the current request's SSR data. Returns undefined when called
 * outside an SSR render (i.e. on the client after hydration).
 *
 * Prefers the ALS-backed provider when registered (server-side),
 * falling back to module-level state (tests, legacy).
 *
 * Used by client hooks' server snapshot functions.
 */
export function getSsrData(): SsrData | undefined {
  if (ssrDataProvider) {
    return ssrDataProvider();
  }
  return currentSsrData;
}
