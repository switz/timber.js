/**
 * Page unload detection — suppresses spurious errors during page refresh/navigation.
 *
 * When the user refreshes the page or navigates away while React is still
 * streaming Suspense content, the aborted connection causes streaming errors.
 * These are not application errors — they're a side effect of the browser
 * tearing down the connection. This module tracks whether the page is being
 * unloaded so error boundaries and error handlers can suppress abort-related
 * errors during the unload window.
 *
 * See design/10-error-handling.md §"Known limitation: deny() inside Suspense and hydration"
 */

let unloading = false;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    unloading = true;
  });

  // Also detect pagehide for bfcache-aware browsers (Safari).
  // pagehide fires for both navigations and page hide events.
  window.addEventListener('pagehide', () => {
    unloading = true;
  });
}

/**
 * Returns true if the page is currently being unloaded (user refreshed
 * or navigated away). Error boundaries should suppress errors in this state.
 */
export function isPageUnloading(): boolean {
  return unloading;
}
