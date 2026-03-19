// Global router reference — shared between browser-entry and client hooks.
// This module has no dependencies on virtual modules, so it can be safely
// imported by client hooks without pulling in browser-entry's virtual imports.
//
// The router is stored on `window.__timber_router` rather than a module-level
// variable to survive module duplication. In Vite dev mode, the shim chain
// (next/navigation → navigation-client.ts → #/client/use-router.js) can
// resolve router-ref.ts via a different module URL than browser-entry.ts's
// relative import, creating two separate module instances with separate
// `globalRouter` variables. Using `window` as the store guarantees a single
// shared reference regardless of module graph topology.

import type { RouterInstance } from './router.js';

declare global {
  interface Window {
    __timber_router?: RouterInstance;
  }
}

/**
 * Set the global router instance. Called once during bootstrap.
 */
export function setGlobalRouter(router: RouterInstance): void {
  if (typeof window !== 'undefined') {
    window.__timber_router = router;
  }
}

/**
 * Get the global router instance. Throws if called before bootstrap.
 * Used by client-side hooks (useNavigationPending, etc.)
 */
export function getRouter(): RouterInstance {
  if (typeof window === 'undefined' || !window.__timber_router) {
    throw new Error('[timber] Router not initialized. getRouter() was called before bootstrap().');
  }
  return window.__timber_router;
}

/**
 * Get the global router instance or null if not yet initialized.
 * Used by useRouter() methods to avoid silent failures — callers
 * can log a meaningful warning instead of silently no-oping.
 */
export function getRouterOrNull(): RouterInstance | null {
  if (typeof window !== 'undefined') {
    return window.__timber_router ?? null;
  }
  return null;
}
