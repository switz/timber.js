/**
 * Stale Client Reference Reload
 *
 * When a new deployment ships updated bundles, clients running stale
 * JavaScript may encounter "Could not find the module" errors during
 * RSC Flight stream decoding. This happens because the RSC payload
 * references module IDs from the new bundle that don't exist in the
 * old client bundle.
 *
 * This module detects these specific errors and triggers a full page
 * reload so the browser fetches the new bundle. A sessionStorage flag
 * guards against infinite reload loops.
 *
 * See: LOCAL-332
 */

const RELOAD_FLAG_KEY = '__timber_stale_reload';

/**
 * Check if an error is a stale client reference error from React's
 * Flight client. These errors have the message pattern:
 *   "Could not find the module \"<id>\""
 *
 * This is thrown by react-server-dom-webpack's client when the RSC
 * payload references a module ID that doesn't exist in the client's
 * module map — typically because the server has been redeployed with
 * new bundle hashes while the client is still running old JavaScript.
 */
export function isStaleClientReference(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return msg.includes('Could not find the module');
}

/**
 * Trigger a full page reload to pick up new bundles.
 *
 * Sets a sessionStorage flag before reloading. If the flag is already
 * set (meaning we already reloaded once for this reason), we don't
 * reload again — this prevents infinite reload loops if the error
 * persists after reload (e.g., a genuine bug rather than a stale bundle).
 *
 * @returns true if a reload was triggered, false if suppressed (loop guard)
 */
export function triggerStaleReload(): boolean {
  try {
    // Check if we already reloaded — prevent infinite loop
    if (sessionStorage.getItem(RELOAD_FLAG_KEY)) {
      console.warn(
        '[timber] Stale client reference detected again after reload. ' +
        'Not reloading to prevent infinite loop. ' +
        'This may indicate a deployment issue — try a hard refresh.'
      );
      return false;
    }

    // Set the flag before reloading
    sessionStorage.setItem(RELOAD_FLAG_KEY, '1');

    console.warn(
      '[timber] Stale client reference detected — the server has been ' +
      'redeployed with new bundles. Reloading to pick up the new version.'
    );

    window.location.reload();
    return true;
  } catch {
    // sessionStorage may be unavailable (private browsing, storage full, etc.)
    // Fall back to reloading without loop protection
    console.warn(
      '[timber] Stale client reference detected. Reloading page.'
    );
    window.location.reload();
    return true;
  }
}

/**
 * Clear the stale reload flag. Called on successful bootstrap to reset
 * the loop guard — if the page loaded successfully, the next stale
 * reference error should trigger a fresh reload attempt.
 */
export function clearStaleReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG_KEY);
  } catch {
    // sessionStorage unavailable — nothing to clear
  }
}
