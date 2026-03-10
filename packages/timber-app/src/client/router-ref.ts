// Global router reference — shared between browser-entry and client hooks.
// This module has no dependencies on virtual modules, so it can be safely
// imported by client hooks without pulling in browser-entry's virtual imports.

import type { RouterInstance } from './router.js';

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
    throw new Error(
      '[timber] Router not initialized. getRouter() was called before bootstrap().'
    );
  }
  return globalRouter;
}
