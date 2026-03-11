// Segment Router — manages client-side navigation and RSC payload fetching
// See design/19-client-navigation.md for the full architecture.

import { SegmentCache, PrefetchCache, buildSegmentTree } from './segment-cache';
import type { SegmentInfo } from './segment-cache';
import { HistoryStack } from './history';
import type { HeadElement } from './head';

// ─── Types ───────────────────────────────────────────────────────

export interface NavigationOptions {
  /** Set to false to prevent scroll-to-top on forward navigation */
  scroll?: boolean;
  /** Use replaceState instead of pushState (replaces current history entry) */
  replace?: boolean;
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
  /**
   * Schedule a callback after the next paint. In the browser, this is
   * requestAnimationFrame + setTimeout(0) to run after React commits.
   * In tests, this runs the callback synchronously.
   */
  afterPaint?: (callback: () => void) => void;
  /** Apply resolved head elements (title, meta tags) to the DOM after navigation. */
  applyHead?: (elements: HeadElement[]) => void;
}

/** Result of fetching an RSC payload — includes head elements and segment metadata. */
interface FetchResult {
  payload: unknown;
  headElements: HeadElement[] | null;
  /** Segment metadata from X-Timber-Segments header for populating the segment cache. */
  segmentInfo: SegmentInfo[] | null;
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
  /**
   * Populate the segment cache from server-provided segment metadata.
   * Called on initial hydration with segment info embedded in the HTML.
   */
  initSegmentCache(segments: SegmentInfo[]): void;
  /** The segment cache (exposed for tests and <Link> prefetch) */
  segmentCache: SegmentCache;
  /** The prefetch cache (exposed for tests and <Link> prefetch) */
  prefetchCache: PrefetchCache;
  /** The history stack (exposed for tests) */
  historyStack: HistoryStack;
}

/**
 * Thrown when an RSC payload response contains X-Timber-Redirect header.
 * Caught in navigate() to trigger a soft router navigation to the redirect target.
 */
class RedirectError extends Error {
  readonly redirectUrl: string;
  constructor(url: string) {
    super(`Server redirect to ${url}`);
    this.redirectUrl = url;
  }
}

// ─── RSC Fetch ───────────────────────────────────────────────────

const RSC_CONTENT_TYPE = 'text/x-component';

/**
 * Generate a short random cache-busting ID (5 chars, a-z0-9).
 * Matches the format Next.js uses for _rsc params.
 */
function generateCacheBustId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 5; i++) {
    id += chars[(Math.random() * 36) | 0];
  }
  return id;
}

/**
 * Append a `_rsc=<id>` query parameter to the URL.
 * Follows Next.js's pattern — prevents CDN/browser from serving cached HTML
 * for RSC navigation requests and signals that this is an RSC fetch.
 */
function appendRscParam(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_rsc=${generateCacheBustId()}`;
}

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
 * Extract head elements from the X-Timber-Head response header.
 * Returns null if the header is missing or malformed.
 */
function extractHeadElements(response: Response): HeadElement[] | null {
  const header = response.headers.get('X-Timber-Head');
  if (!header) return null;
  try {
    return JSON.parse(decodeURIComponent(header));
  } catch {
    return null;
  }
}

/**
 * Extract segment metadata from the X-Timber-Segments response header.
 * Returns null if the header is missing or malformed.
 *
 * Format: JSON array of {path, isAsync} objects describing the rendered
 * segment chain from root to leaf. Used to populate the client-side
 * segment cache for state tree diffing on subsequent navigations.
 */
function extractSegmentInfo(response: Response): SegmentInfo[] | null {
  const header = response.headers.get('X-Timber-Segments');
  if (!header) return null;
  try {
    return JSON.parse(header);
  } catch {
    return null;
  }
}

/**
 * Fetch an RSC payload from the server. If a decodeRsc function is provided,
 * the response is decoded into a React element tree via createFromFetch.
 * Otherwise, the raw response text is returned (test mode).
 *
 * Also extracts head elements from the X-Timber-Head response header
 * so the client can update document.title and <meta> tags after navigation.
 */
async function fetchRscPayload(
  url: string,
  deps: RouterDeps,
  stateTree?: { segments: string[] }
): Promise<FetchResult> {
  const rscUrl = appendRscParam(url);
  const headers = buildRscHeaders(stateTree);
  if (deps.decodeRsc) {
    // Production path: use createFromFetch for streaming RSC decoding.
    // createFromFetch takes a Promise<Response> and progressively parses
    // the RSC Flight stream as chunks arrive.
    //
    // Intercept the response to read X-Timber-Head before createFromFetch
    // consumes the body. Reading headers does NOT consume the body stream.
    const fetchPromise = deps.fetch(rscUrl, { headers, redirect: 'manual' });
    let headElements: HeadElement[] | null = null;
    let segmentInfo: SegmentInfo[] | null = null;
    const wrappedPromise = fetchPromise.then((response) => {
      // Detect server-side redirects via 3xx status + Location header.
      // RSC fetches use redirect: "manual" so the browser doesn't auto-follow
      // 302s (which would return HTML and break createFromFetch). Instead we
      // read the Location header and throw RedirectError for the router to
      // handle as a soft navigation.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        if (location) {
          throw new RedirectError(location);
        }
      }
      headElements = extractHeadElements(response);
      segmentInfo = extractSegmentInfo(response);
      return response;
    });
    // Await so headElements/segmentInfo are populated before we return.
    // Also await the decoded payload — createFromFetch returns a thenable
    // that resolves to the React element tree.
    await wrappedPromise;
    const payload = await deps.decodeRsc(wrappedPromise);
    return { payload, headElements, segmentInfo };
  }
  // Test/fallback path: return raw text
  const response = await deps.fetch(rscUrl, { headers, redirect: 'manual' });
  // Check for redirect in test path too
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location');
    if (location) {
      throw new RedirectError(location);
    }
  }
  return {
    payload: await response.text(),
    headElements: extractHeadElements(response),
    segmentInfo: extractSegmentInfo(response),
  };
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

  /** Update the segment cache from server-provided segment metadata. */
  function updateSegmentCache(segmentInfo: SegmentInfo[] | null | undefined): void {
    if (!segmentInfo || segmentInfo.length === 0) return;
    const tree = buildSegmentTree(segmentInfo);
    if (tree) {
      segmentCache.set('/', tree);
    }
  }

  /** Render a decoded RSC payload into the DOM if a renderer is available. */
  function renderPayload(payload: unknown): void {
    if (deps.renderRoot) {
      deps.renderRoot(payload);
    }
  }

  /** Apply head elements (title, meta tags) to the DOM if available. */
  function applyHead(elements: HeadElement[] | null | undefined): void {
    if (elements && deps.applyHead) {
      deps.applyHead(elements);
    }
  }

  /** Run a callback after the next paint (after React commit). */
  function afterPaint(callback: () => void): void {
    if (deps.afterPaint) {
      deps.afterPaint(callback);
    } else {
      callback();
    }
  }

  async function navigate(url: string, options: NavigationOptions = {}): Promise<void> {
    const scroll = options.scroll !== false;
    const replace = options.replace === true;

    // Save current page to history stack before navigating away
    const currentUrl = deps.getCurrentUrl();
    const currentScrollY = deps.getScrollY();
    if (historyStack.has(currentUrl)) {
      historyStack.updateScroll(currentUrl, currentScrollY);
    }

    setPending(true);

    try {
      // Check prefetch cache first
      let result = prefetchCache.consume(url);

      if (result === undefined) {
        // Fetch RSC payload with state tree for partial rendering
        const stateTree = segmentCache.serializeStateTree();
        result = await fetchRscPayload(url, deps, stateTree);
      }

      // Update the browser history — replace mode overwrites the current entry
      if (replace) {
        deps.replaceState({ timber: true }, '', url);
      } else {
        deps.pushState({ timber: true }, '', url);
      }

      // Store the payload in the history stack
      historyStack.push(url, {
        payload: result.payload,
        scrollY: 0,
        headElements: result.headElements,
      });

      // Update the segment cache with the new route's segment tree.
      // This must happen before the next navigation so the state tree
      // header reflects the currently mounted segments.
      updateSegmentCache(result.segmentInfo);

      // Render the decoded RSC tree into the DOM.
      // React's render() on the document root can cause the browser to
      // reset scroll to 0 during DOM reconciliation. We must actively
      // restore scroll after paint when scroll={false}.
      renderPayload(result.payload);

      // Update document.title and <meta> tags with the new page's metadata
      applyHead(result.headElements);

      // Notify nuqs adapter (and any other listeners) that navigation completed.
      // The nuqs adapter syncs its searchParams state from window.location.search
      // on this event so URL-bound inputs reflect the new URL after navigation.
      window.dispatchEvent(new Event('timber:navigation-end'));

      afterPaint(() => {
        if (scroll) {
          deps.scrollTo(0, 0);
        } else {
          deps.scrollTo(0, currentScrollY);
        }
      });
    } catch (error) {
      // Server-side redirect during RSC fetch → soft router navigation.
      // access.ts called redirect() — the server returns X-Timber-Redirect
      // header, and fetchRscPayload throws RedirectError. We re-navigate
      // to the redirect target using the router for a seamless SPA transition.
      if (error instanceof RedirectError) {
        setPending(false);
        await navigate(error.redirectUrl, { replace: true });
        return;
      }
      throw error;
    } finally {
      setPending(false);
    }
  }

  async function refresh(): Promise<void> {
    const currentUrl = deps.getCurrentUrl();

    setPending(true);

    try {
      // No state tree sent — server renders the complete RSC payload
      const result = await fetchRscPayload(currentUrl, deps);

      // Update the history entry with the fresh payload
      historyStack.push(currentUrl, {
        payload: result.payload,
        scrollY: deps.getScrollY(),
        headElements: result.headElements,
      });

      // Update segment cache with fresh segment info from full render
      updateSegmentCache(result.segmentInfo);

      // Render the fresh RSC tree and update head elements
      renderPayload(result.payload);
      applyHead(result.headElements);
    } finally {
      setPending(false);
    }
  }

  async function handlePopState(url: string): Promise<void> {
    const entry = historyStack.get(url);

    if (entry && entry.payload !== null) {
      // Replay cached payload — no server roundtrip
      renderPayload(entry.payload);
      applyHead(entry.headElements);
      afterPaint(() => deps.scrollTo(0, entry.scrollY));
    } else {
      // No cached payload — fetch from server.
      // This happens when navigating back to the initial SSR'd page
      // (its payload is null since it was rendered via SSR, not RSC fetch)
      // or when the entry doesn't exist at all.
      const savedScrollY = entry?.scrollY ?? 0;
      setPending(true);
      try {
        const stateTree = segmentCache.serializeStateTree();
        const result = await fetchRscPayload(url, deps, stateTree);
        updateSegmentCache(result.segmentInfo);
        historyStack.push(url, {
          payload: result.payload,
          scrollY: savedScrollY,
          headElements: result.headElements,
        });
        renderPayload(result.payload);
        applyHead(result.headElements);
        afterPaint(() => deps.scrollTo(0, savedScrollY));
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
      (result) => {
        prefetchCache.set(url, result);
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
    initSegmentCache: (segments: SegmentInfo[]) => updateSegmentCache(segments),
    segmentCache,
    prefetchCache,
    historyStack,
  };
}
