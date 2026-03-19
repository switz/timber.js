// Global router reference — shared between browser-entry and client hooks.
// This module has no dependencies on virtual modules, so it can be safely
// imported by client hooks without pulling in browser-entry's virtual imports.
//
// The router is stored as a module-level variable. browser-entry.ts and all
// shim files import from @timber-js/app/client (the public barrel) rather
// than relative paths or #/ subpath imports. This ensures all import chains
// resolve to the same module instance via Vite's dep optimizer, preventing
// the duplication that previously required a window.__timber_router workaround.
//
// See design/18-build-system.md §"Module Singleton Strategy"

import type { RouterInstance } from './router.js';

/** Module-level singleton — set once during bootstrap. */
let globalRouter: RouterInstance | null = null;

/**
 * Set the global router instance. Called once during bootstrap.
 */
export function setGlobalRouter(router: RouterInstance): void {
  globalRouter = router;
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
  globalRouter = null;
}
