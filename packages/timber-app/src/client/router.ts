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
 * Function that decodes an RSC Flight stream into a React element tree.
 * In production: createFromFetch from @vitejs/plugin-rsc/browser.
 * In tests: a mock that returns the raw payload.
 */
export type RscDecoder = (fetchPromise: Promise<Response>) => unknown;

/**
 * Function that renders a decoded RSC element tree into the DOM.
 * In production: reactRoot.render(element).
 * In tests: a no-op or mock.
 */
export type RootRenderer = (element: unknown) => void;

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
  /** Decode RSC Flight stream into React elements. If not provided, raw response text is stored. */
  decodeRsc?: RscDecoder;
  /** Render decoded RSC tree into the DOM. If not provided, rendering is a no-op. */
  renderRoot?: RootRenderer;
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
  /** Prefetch an RSC payload for a URL (used by Link hover) */
  prefetch(url: string): void;
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

/**
 * Fetch an RSC payload from the server. If a decodeRsc function is provided,
 * the response is decoded into a React element tree via createFromFetch.
 * Otherwise, the raw response text is returned (test mode).
 */
async function fetchRscPayload(
  url: string,
  deps: RouterDeps,
  stateTree?: { segments: string[] }
): Promise<unknown> {
  const headers = buildRscHeaders(stateTree);
  if (deps.decodeRsc) {
    // Production path: use createFromFetch for streaming RSC decoding.
    // createFromFetch takes a Promise<Response> and progressively parses
    // the RSC Flight stream as chunks arrive.
    const fetchPromise = deps.fetch(url, { headers });
    return deps.decodeRsc(fetchPromise);
  }
  // Test/fallback path: return raw text
  const response = await deps.fetch(url, { headers });
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

  /** Render a decoded RSC payload into the DOM if a renderer is available. */
  function renderPayload(payload: unknown): void {
    if (deps.renderRoot) {
      deps.renderRoot(payload);
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

      // Render the decoded RSC tree into the DOM
      renderPayload(payload);

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

      // Render the fresh RSC tree
      renderPayload(payload);
    } finally {
      setPending(false);
    }
  }

  async function handlePopState(url: string): Promise<void> {
    const entry = historyStack.get(url);

    if (entry) {
      // Replay cached payload — no server roundtrip
      renderPayload(entry.payload);
      deps.scrollTo(0, entry.scrollY);
    } else {
      // No cached entry — fetch from server
      setPending(true);
      try {
        const stateTree = segmentCache.serializeStateTree();
        const payload = await fetchRscPayload(url, deps, stateTree);
        historyStack.push(url, { payload, scrollY: 0 });
        renderPayload(payload);
        deps.scrollTo(0, 0);
      } finally {
        setPending(false);
      }
    }
  }

  /**
   * Prefetch an RSC payload for a URL and store it in the prefetch cache.
   * Called on hover of <Link prefetch> elements.
   */
  function prefetch(url: string): void {
    // Don't prefetch if already cached
    if (prefetchCache.get(url) !== undefined) return;
    if (historyStack.has(url)) return;

    // Fire-and-forget fetch
    const stateTree = segmentCache.serializeStateTree();
    void fetchRscPayload(url, deps, stateTree).then(
      (payload) => {
        prefetchCache.set(url, payload);
      },
      () => {
        // Prefetch failure is non-fatal — navigation will fetch fresh
      }
    );
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
    prefetch,
    segmentCache,
    prefetchCache,
    historyStack,
  };
}
