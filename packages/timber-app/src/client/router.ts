// Segment Router — manages client-side navigation and RSC payload fetching
// See design/19-client-navigation.md for the full architecture.

import { SegmentCache, PrefetchCache } from './segment-cache';
import { HistoryStack } from './history';

// ─── Types ───────────────────────────────────────────────────────

export interface NavigationOptions {
  /** Set to false to prevent scroll-to-top on forward navigation */
  scroll?: boolean;
}

/**
 * Platform dependencies injected for testability. In production these
 * map to browser APIs; in tests they're replaced with mocks.
 */
export interface RouterDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  pushState: (data: unknown, unused: string, url: string) => void;
  replaceState: (data: unknown, unused: string, url: string) => void;
  scrollTo: (x: number, y: number) => void;
  getCurrentUrl: () => string;
  getScrollY: () => number;
}

export interface RouterInstance {
  /** Navigate to a new URL (forward navigation) */
  navigate(url: string, options?: NavigationOptions): Promise<void>;
  /** Full re-render of the current URL — no state tree sent */
  refresh(): Promise<void>;
  /** Handle a popstate event (back/forward button) */
  handlePopState(url: string): Promise<void>;
  /** Whether a navigation is currently in flight */
  isPending(): boolean;
  /** Subscribe to pending state changes */
  onPendingChange(listener: (pending: boolean) => void): () => void;
  /** The segment cache (exposed for tests and <Link> prefetch) */
  segmentCache: SegmentCache;
  /** The prefetch cache (exposed for tests and <Link> prefetch) */
  prefetchCache: PrefetchCache;
  /** The history stack (exposed for tests) */
  historyStack: HistoryStack;
}

// ─── RSC Fetch ───────────────────────────────────────────────────

const RSC_CONTENT_TYPE = 'text/x-component';

function buildRscHeaders(stateTree: { segments: string[] } | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: RSC_CONTENT_TYPE,
  };
  if (stateTree) {
    headers['X-Timber-State-Tree'] = JSON.stringify(stateTree);
  }
  return headers;
}

async function fetchRscPayload(
  url: string,
  deps: RouterDeps,
  stateTree?: { segments: string[] }
): Promise<unknown> {
  const headers = buildRscHeaders(stateTree);
  const response = await deps.fetch(url, { headers });
  // In production, this would use createFromFetch() to parse the RSC stream.
  // For now, we return the raw response body as the payload.
  return response.text();
}

// ─── Router Factory ──────────────────────────────────────────────

/**
 * Create a router instance. In production, called once at app hydration
 * with real browser APIs. In tests, called with mock dependencies.
 */
export function createRouter(deps: RouterDeps): RouterInstance {
  const segmentCache = new SegmentCache();
  const prefetchCache = new PrefetchCache();
  const historyStack = new HistoryStack();

  let pending = false;
  const pendingListeners = new Set<(pending: boolean) => void>();

  function setPending(value: boolean): void {
    if (pending !== value) {
      pending = value;
      for (const listener of pendingListeners) {
        listener(value);
      }
    }
  }

  async function navigate(url: string, options: NavigationOptions = {}): Promise<void> {
    const scroll = options.scroll !== false;

    // Save current page to history stack before navigating away
    const currentUrl = deps.getCurrentUrl();
    const currentScrollY = deps.getScrollY();
    if (historyStack.has(currentUrl)) {
      historyStack.updateScroll(currentUrl, currentScrollY);
    }

    setPending(true);

    try {
      // Check prefetch cache first
      let payload = prefetchCache.consume(url);

      if (payload === undefined) {
        // Fetch RSC payload with state tree for partial rendering
        const stateTree = segmentCache.serializeStateTree();
        payload = await fetchRscPayload(url, deps, stateTree);
      }

      // Push the new URL to the browser history
      deps.pushState({ timber: true }, '', url);

      // Store the payload in the history stack
      historyStack.push(url, { payload, scrollY: 0 });

      // In production: call reactRoot.render() with the parsed RSC tree here.
      // The actual React reconciliation is handled by the entry module.

      // Scroll to top on forward navigation (unless opted out)
      if (scroll) {
        deps.scrollTo(0, 0);
      }
    } finally {
      setPending(false);
    }
  }

  async function refresh(): Promise<void> {
    const currentUrl = deps.getCurrentUrl();

    setPending(true);

    try {
      // No state tree sent — server renders the complete RSC payload
      const payload = await fetchRscPayload(currentUrl, deps);

      // Update the history entry with the fresh payload
      historyStack.push(currentUrl, {
        payload,
        scrollY: deps.getScrollY(),
      });

      // In production: call reactRoot.render() with the full RSC tree.
    } finally {
      setPending(false);
    }
  }

  async function handlePopState(url: string): Promise<void> {
    const entry = historyStack.get(url);

    if (entry) {
      // Replay cached payload — no server roundtrip
      // In production: call reactRoot.render() with the cached RSC tree.
      deps.scrollTo(0, entry.scrollY);
    } else {
      // No cached entry — fetch from server
      setPending(true);
      try {
        const stateTree = segmentCache.serializeStateTree();
        const payload = await fetchRscPayload(url, deps, stateTree);
        historyStack.push(url, { payload, scrollY: 0 });
        deps.scrollTo(0, 0);
      } finally {
        setPending(false);
      }
    }
  }

  return {
    navigate,
    refresh,
    handlePopState,
    isPending: () => pending,
    onPendingChange(listener) {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    segmentCache,
    prefetchCache,
    historyStack,
  };
}
