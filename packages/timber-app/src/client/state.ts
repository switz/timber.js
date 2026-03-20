/**
 * Centralized client singleton state registry.
 *
 * ALL mutable module-level state that must have singleton semantics across
 * the client bundle lives here. Individual modules (router-ref.ts, ssr-data.ts,
 * use-params.ts, use-search-params.ts, unload-guard.ts) import from this file
 * and re-export thin wrapper functions.
 *
 * Why: In Vite dev, a module is instantiated separately if reached via different
 * import paths (e.g., relative `./foo.js` vs barrel `@timber-js/app/client`).
 * By centralizing all mutable state in a single module that is always reached
 * through the same dependency chain (barrel → wrapper → state.ts), we guarantee
 * a single instance of every piece of shared state.
 *
 * DO NOT import this file from outside client/. Server code must never depend
 * on client state. The barrel (client/index.ts) is the public entry point.
 *
 * See design/18-build-system.md §"Module Singleton Strategy" and
 * §"Singleton State Registry".
 */

import type { RouterInstance } from './router.js';
import type { SsrData } from './ssr-data.js';

// ─── Router (from router-ref.ts) ──────────────────────────────────────────

/** The global router singleton — set once during bootstrap. */
export let globalRouter: RouterInstance | null = null;

export function _setGlobalRouter(router: RouterInstance | null): void {
  globalRouter = router;
}

// ─── SSR Data Provider (from ssr-data.ts) ──────────────────────────────────

/**
 * ALS-backed SSR data provider. When registered, getSsrData() reads from
 * this function (ALS store) instead of module-level currentSsrData.
 */
export let ssrDataProvider: (() => SsrData | undefined) | undefined;

export function _setSsrDataProvider(provider: (() => SsrData | undefined) | undefined): void {
  ssrDataProvider = provider;
}

/** Fallback SSR data for tests and environments without ALS. */
export let currentSsrData: SsrData | undefined;

export function _setCurrentSsrData(data: SsrData | undefined): void {
  currentSsrData = data;
}

// ─── Route Params (from use-params.ts) ──────────────────────────────────────

/** Current route params snapshot — replaced (not mutated) on each navigation. */
export let currentParams: Record<string, string | string[]> = {};

export function _setCurrentParams(params: Record<string, string | string[]>): void {
  currentParams = params;
}

/** Listeners notified when currentParams changes. */
export const paramsListeners = new Set<() => void>();

// ─── Search Params Cache (from use-search-params.ts) ────────────────────────

/** Cached search string — avoids reparsing when URL hasn't changed. */
export let cachedSearch = '';
export let cachedSearchParams = new URLSearchParams();

export function _setCachedSearch(search: string, params: URLSearchParams): void {
  cachedSearch = search;
  cachedSearchParams = params;
}

// ─── Unload Guard (from unload-guard.ts) ─────────────────────────────────────

/** Whether the page is currently being unloaded. */
export let unloading = false;

export function _setUnloading(value: boolean): void {
  unloading = value;
}
