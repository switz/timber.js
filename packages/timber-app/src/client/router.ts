// Segment Router — manages client-side navigation and RSC payload fetching
// See design/19-client-navigation.md for the full architecture.

import { SegmentCache, PrefetchCache, buildSegmentTree } from './segment-cache';
import type { SegmentInfo } from './segment-cache';
import { HistoryStack } from './history';
import type { HeadElement } from './head';
import { setCurrentParams } from './use-params.js';
import { getNavigationState, setNavigationState } from './navigation-context.js';

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
  /** Route params from X-Timber-Params header for populating useParams(). */
  params: Record<string, string | string[]> | null;
}

export interface RouterInstance {
  /** Navigate to a new URL (forward navigation) */
  navigate(url: string, options?: NavigationOptions): Promise<void>;
  /** Full re-render of the current URL — no state tree sent */
  refresh(): Promise<void>;
  /** Handle a popstate event (back/forward button). scrollY is read from history.state. */
  handlePopState(url: string, scrollY?: number): Promise<void>;
  /** Whether a navigation is currently in flight */
  isPending(): boolean;
  /** The URL currently being navigated to, or null if idle */
  getPendingUrl(): string | null;
  /** Subscribe to pending state changes */
  onPendingChange(listener: (pending: boolean) => void): () => void;
  /** Prefetch an RSC payload for a URL (used by Link hover) */
  prefetch(url: string): void;
  /**
   * Apply a piggybacked revalidation payload from a server action response.
   * Renders the element tree and updates head elements without a server fetch.
   * See design/08-forms-and-actions.md §"Single-Roundtrip Revalidation".
   */
  applyRevalidation(element: unknown, headElements: HeadElement[] | null): void;
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

/**
 * Check if an error is an abort error (connection closed / fetch aborted).
 * Browsers throw DOMException with name 'AbortError' when a fetch is aborted.
 */
function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
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

function buildRscHeaders(
  stateTree: { segments: string[] } | undefined,
  currentUrl?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: RSC_CONTENT_TYPE,
  };
  if (stateTree) {
    headers['X-Timber-State-Tree'] = JSON.stringify(stateTree);
  }
  // Send current URL for intercepting route resolution.
  // The server uses this to determine if an intercepting route should
  // render instead of the actual target route (modal pattern).
  // See design/07-routing.md §"Intercepting Routes"
  if (currentUrl) {
    headers['X-Timber-URL'] = currentUrl;
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
 * Extract route params from the X-Timber-Params response header.
 * Returns null if the header is missing or malformed.
 *
 * Used to populate useParams() after client-side navigation.
 */
function extractParams(response: Response): Record<string, string | string[]> | null {
  const header = response.headers.get('X-Timber-Params');
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
  stateTree?: { segments: string[] },
  currentUrl?: string
): Promise<FetchResult> {
  const rscUrl = appendRscParam(url);
  const headers = buildRscHeaders(stateTree, currentUrl);
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
    let params: Record<string, string | string[]> | null = null;
    const wrappedPromise = fetchPromise.then((response) => {
      // Detect server-side redirects. The server returns 204 + X-Timber-Redirect
      // for RSC payload requests instead of a raw 302, because fetch with
      // redirect: "manual" turns 302s into opaque redirects (status 0, null body)
      // which crashes createFromFetch when it tries to read the body stream.
      const redirectLocation =
        response.headers.get('X-Timber-Redirect') ||
        (response.status >= 300 && response.status < 400 ? response.headers.get('Location') : null);
      if (redirectLocation) {
        throw new RedirectError(redirectLocation);
      }
      headElements = extractHeadElements(response);
      segmentInfo = extractSegmentInfo(response);
      params = extractParams(response);
      return response;
    });
    // Await so headElements/segmentInfo/params are populated before we return.
    // Also await the decoded payload — createFromFetch returns a thenable
    // that resolves to the React element tree.
    await wrappedPromise;
    const payload = await deps.decodeRsc(wrappedPromise);
    return { payload, headElements, segmentInfo, params };
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
    params: extractParams(response),
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
  let pendingUrl: string | null = null;
  const pendingListeners = new Set<(pending: boolean) => void>();
  /** Last rendered payload — used to re-render at navigation start with pendingUrl set. */
  let lastRenderedPayload: unknown = null;

  function setPending(value: boolean, url?: string): void {
    const newPendingUrl = value && url ? url : null;
    if (pending === value && pendingUrl === newPendingUrl) return;
    pending = value;
    pendingUrl = newPendingUrl;
    // Notify external store listeners (useNavigationPending, etc.)
    for (const listener of pendingListeners) {
      listener(value);
    }
    // When navigation starts, re-render the current tree with pendingUrl
    // set in NavigationContext. This makes the pending state visible to
    // LinkStatusProvider atomically via React context, avoiding the
    // two-commit gap between useSyncExternalStore and context updates.
    if (value && lastRenderedPayload !== null) {
      const currentState = getNavigationState();
      setNavigationState({ ...currentState, pendingUrl: newPendingUrl });
      renderPayload(lastRenderedPayload);
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
    lastRenderedPayload = payload;
    if (deps.renderRoot) {
      deps.renderRoot(payload);
    }
  }

  /**
   * Update navigation state (params + pathname + pendingUrl) for the next render.
   *
   * Sets both the module-level fallback (for tests and SSR) and the
   * navigation context state (read by renderRoot to wrap the element
   * in NavigationProvider). The context update is atomic with the tree
   * render — both are passed to reactRoot.render() in the same call.
   *
   * pendingUrl is included so that LinkStatusProvider (which reads from
   * NavigationContext) sees the pending state change in the same React
   * commit as params/pathname — preventing the gap where the spinner
   * disappears before the active state updates.
   */
  function updateNavigationState(
    params: Record<string, string | string[]> | null | undefined,
    url: string,
    navPendingUrl: string | null = null
  ): void {
    const resolvedParams = params ?? {};
    // Module-level fallback for tests (no NavigationProvider) and SSR
    setCurrentParams(resolvedParams);
    // Navigation context — read by renderRoot to wrap the RSC element
    const pathname = url.startsWith('http')
      ? new URL(url).pathname
      : url.split('?')[0] || '/';
    setNavigationState({ params: resolvedParams, pathname, pendingUrl: navPendingUrl });
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

    // Capture the departing page's scroll position for scroll={false} preservation.
    const currentScrollY = deps.getScrollY();

    // Save the departing page's scroll position in history.state before
    // pushing a new entry. This ensures back/forward navigation can restore
    // the correct scroll position from the browser's per-entry state.
    deps.replaceState({ timber: true, scrollY: currentScrollY }, '', deps.getCurrentUrl());

    setPending(true, url);

    try {
      // Check prefetch cache first
      let result = prefetchCache.consume(url);

      if (result === undefined) {
        // Fetch RSC payload with state tree for partial rendering.
        // Send current URL for intercepting route resolution (modal pattern).
        const stateTree = segmentCache.serializeStateTree();
        const rawCurrentUrl = deps.getCurrentUrl();
        const currentUrl = rawCurrentUrl.startsWith('http')
          ? new URL(rawCurrentUrl).pathname
          : new URL(rawCurrentUrl, 'http://localhost').pathname;
        result = await fetchRscPayload(url, deps, stateTree, currentUrl);
      }

      // Update the browser history — replace mode overwrites the current entry
      if (replace) {
        deps.replaceState({ timber: true, scrollY: 0 }, '', url);
      } else {
        deps.pushState({ timber: true, scrollY: 0 }, '', url);
      }

      // Store the payload in the history stack
      historyStack.push(url, {
        payload: result.payload,
        headElements: result.headElements,
        params: result.params,
      });

      // Update the segment cache with the new route's segment tree.
      // This must happen before the next navigation so the state tree
      // header reflects the currently mounted segments.
      updateSegmentCache(result.segmentInfo);

      // Update navigation state (params + pathname) before rendering.
      // The renderRoot callback reads this state and wraps the RSC element
      // in NavigationProvider — so the context value and the element tree
      // are passed to reactRoot.render() in the same call, making the
      // update atomic. Preserved layouts see new params in the same render
      // pass as the new tree, preventing the dual-active-row flash.
      updateNavigationState(result.params, url);
      renderPayload(result.payload);

      // Update document.title and <meta> tags with the new page's metadata
      applyHead(result.headElements);

      // Notify nuqs adapter (and any other listeners) that navigation completed.
      // The nuqs adapter syncs its searchParams state from window.location.search
      // on this event so URL-bound inputs reflect the new URL after navigation.
      window.dispatchEvent(new Event('timber:navigation-end'));

      // Scroll-to-top on forward navigation, or restore captured position
      // for scroll={false}. React's render() on the document root can reset
      // scroll during DOM reconciliation, so all scroll must be actively managed.
      afterPaint(() => {
        if (scroll) {
          deps.scrollTo(0, 0);
        } else {
          deps.scrollTo(0, currentScrollY);
        }
        window.dispatchEvent(new Event('timber:scroll-restored'));
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
      // Abort errors from the fetch (user refreshed or navigated away
      // while the RSC payload was loading) are not application errors.
      // Swallow them silently — the page is being replaced.
      if (isAbortError(error)) return;
      throw error;
    } finally {
      setPending(false);
    }
  }

  async function refresh(): Promise<void> {
    const currentUrl = deps.getCurrentUrl();

    setPending(true, currentUrl);

    try {
      // No state tree sent — server renders the complete RSC payload
      const result = await fetchRscPayload(currentUrl, deps);

      // Update the history entry with the fresh payload
      historyStack.push(currentUrl, {
        payload: result.payload,
        headElements: result.headElements,
        params: result.params,
      });

      // Update segment cache with fresh segment info from full render
      updateSegmentCache(result.segmentInfo);

      // Atomic update — see navigate() for rationale on NavigationProvider.
      updateNavigationState(result.params, currentUrl);
      renderPayload(result.payload);
      applyHead(result.headElements);
    } finally {
      setPending(false);
    }
  }

  async function handlePopState(url: string, scrollY: number = 0): Promise<void> {
    // Scroll position is read from history.state by the caller (browser-entry.ts)
    // and passed in. This is more reliable than tracking scroll per-URL in memory
    // because the browser maintains per-entry state even with duplicate URLs.
    const entry = historyStack.get(url);

    if (entry && entry.payload !== null) {
      // Replay cached payload — no server roundtrip
      updateNavigationState(entry.params, url);
      renderPayload(entry.payload);
      applyHead(entry.headElements);
      afterPaint(() => {
        deps.scrollTo(0, scrollY);
        window.dispatchEvent(new Event('timber:scroll-restored'));
      });
    } else {
      // No cached payload — fetch from server.
      // This happens when navigating back to the initial SSR'd page
      // (its payload is null since it was rendered via SSR, not RSC fetch)
      // or when the entry doesn't exist at all.
      setPending(true, url);
      try {
        const stateTree = segmentCache.serializeStateTree();
        const result = await fetchRscPayload(url, deps, stateTree);
        updateSegmentCache(result.segmentInfo);
        updateNavigationState(result.params, url);
        historyStack.push(url, {
          payload: result.payload,
          headElements: result.headElements,
          params: result.params,
        });
        renderPayload(result.payload);
        applyHead(result.headElements);
        afterPaint(() => {
          deps.scrollTo(0, scrollY);
          window.dispatchEvent(new Event('timber:scroll-restored'));
        });
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
    getPendingUrl: () => pendingUrl,
    onPendingChange(listener) {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    prefetch,
    applyRevalidation(element: unknown, headElements: HeadElement[] | null): void {
      // Render the piggybacked element tree from a server action response.
      // Updates the current history entry with the fresh payload and applies
      // head elements — same as refresh() but without a server fetch.
      const currentUrl = deps.getCurrentUrl();
      historyStack.push(currentUrl, {
        payload: element,
        headElements,
      });
      renderPayload(element);
      applyHead(headElements);
    },
    initSegmentCache: (segments: SegmentInfo[]) => updateSegmentCache(segments),
    segmentCache,
    prefetchCache,
    historyStack,
  };
}
