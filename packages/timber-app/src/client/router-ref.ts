// Global router reference — shared between browser-entry and client hooks.
//
// Delegates to client/state.ts for the actual module-level variable.
// This ensures singleton semantics regardless of import path — all
// callers converge on the same state.ts instance via the barrel.
//
// See design/18-build-system.md §"Module Singleton Strategy"

import type { RouterInstance } from './router.js';
import { globalRouter, _setGlobalRouter } from './state.js';

/**
 * Set the global router instance. Called once during bootstrap.
 */
export function setGlobalRouter(router: RouterInstance): void {
  _setGlobalRouter(router);
}

/**
 * Get the global router instance. Throws if called before bootstrap.
 * Used by client-side hooks (useNavigationPending, etc.)
 */
export function getRouter(): RouterInstance {
  if (!globalRouter) {
    throw new Error('[timber] Router not initialized. getRouter() was called before bootstrap().');
  }
  return globalRouter;
}

/**
 * Get the global router instance or null if not yet initialized.
 * Used by useRouter() methods to avoid silent failures — callers
 * can log a meaningful warning instead of silently no-oping.
 */
export function getRouterOrNull(): RouterInstance | null {
  return globalRouter;
}

/**
 * Reset the global router to null. Used only in tests to isolate
 * module-level state between test cases.
 * @internal
 */
export function resetGlobalRouter(): void {
  _setGlobalRouter(null);
}
