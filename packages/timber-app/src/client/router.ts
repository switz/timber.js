// Segment Router — manages client-side navigation and RSC payload fetching
// See design/19-client-navigation.md for the full architecture.

import { SegmentCache, PrefetchCache, buildSegmentTree } from './segment-cache';
import type { SegmentInfo } from './segment-cache';
import { HistoryStack } from './history';
import type { HeadElement } from './head';
import { setCurrentParams } from './use-params.js';
import { setNavigationState } from './navigation-context.js';
import {
  SegmentElementCache,
  cacheSegmentElements,
  mergeSegmentTree,
} from './segment-merger.js';
import { fetchRscPayload, RedirectError } from './rsc-fetch.js';
import type { FetchResult } from './rsc-fetch.js';

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
  /**
   * Run a navigation inside a React transition with optimistic pending URL.
   * The pending URL shows immediately (useOptimistic urgent update) and
   * reverts when the transition commits (atomic with the new tree).
   *
   * The `perform` callback receives a `wrapPayload` function to wrap the
   * decoded RSC payload with NavigationProvider + NuqsAdapter before
   * TransitionRoot sets it as the new element.
   *
   * If not provided (tests), the router falls back to renderRoot.
   */
  navigateTransition?: (
    pendingUrl: string,
    perform: (wrapPayload: (payload: unknown) => unknown) => Promise<unknown>
  ) => Promise<void>;
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
  /**
   * Cache segment elements from a decoded RSC element tree.
   * Called on initial hydration to populate the element cache so the
   * first client navigation can use partial payloads.
   */
  cacheElementTree(element: unknown): void;
  /** The segment cache (exposed for tests and <Link> prefetch) */
  segmentCache: SegmentCache;
  /** The prefetch cache (exposed for tests and <Link> prefetch) */
  prefetchCache: PrefetchCache;
  /** The history stack (exposed for tests) */
  historyStack: HistoryStack;
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

// ─── Router Factory ──────────────────────────────────────────────

/**
 * Create a router instance. In production, called once at app hydration
 * with real browser APIs. In tests, called with mock dependencies.
 */
export function createRouter(deps: RouterDeps): RouterInstance {
  const segmentCache = new SegmentCache();
  const prefetchCache = new PrefetchCache();
  const historyStack = new HistoryStack();
  const segmentElementCache = new SegmentElementCache();

  let pending = false;
  let pendingUrl: string | null = null;
  const pendingListeners = new Set<(pending: boolean) => void>();

  function setPending(value: boolean, url?: string): void {
    const newPendingUrl = value && url ? url : null;
    if (pending === value && pendingUrl === newPendingUrl) return;
    pending = value;
    pendingUrl = newPendingUrl;
    // Notify external store listeners (non-React consumers).
    // React-facing pending state is handled by useOptimistic in
    // TransitionRoot via navigateTransition — not this function.
    for (const listener of pendingListeners) {
      listener(value);
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

  /**
   * Merge a partial RSC payload with cached segment elements if segments
   * were skipped, then cache segments from the (merged) payload.
   * Returns the merged payload ready for rendering.
   */
  function mergeAndCachePayload(
    payload: unknown,
    skippedSegments: string[] | null | undefined
  ): unknown {
    let merged = payload;

    // If segments were skipped, merge the partial payload with cached segments
    if (skippedSegments && skippedSegments.length > 0) {
      merged = mergeSegmentTree(payload, skippedSegments, segmentElementCache);
    }

    // Cache segment elements from the (merged) payload for future merges
    cacheSegmentElements(merged, segmentElementCache);

    return merged;
  }

  /**
   * Update navigation state (params + pathname) for the next render.
   *
   * Sets both the module-level fallback (for tests and SSR) and the
   * navigation context state (read by renderRoot to wrap the element
   * in NavigationProvider). The context update is atomic with the tree
   * render — both are passed to reactRoot.render() in the same call.
   */
  function updateNavigationState(
    params: Record<string, string | string[]> | null | undefined,
    url: string
  ): void {
    const resolvedParams = params ?? {};
    // Module-level fallback for tests (no NavigationProvider) and SSR
    setCurrentParams(resolvedParams);
    // Navigation context — read by renderRoot to wrap the RSC element
    const pathname = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0] || '/';
    setNavigationState({ params: resolvedParams, pathname });
  }

  /**
   * Render a payload via navigateTransition (production) or renderRoot (tests).
   * The perform callback should fetch data, update state, and return the payload.
   * In production, the entire callback runs inside a React transition with
   * useOptimistic for the pending URL. In tests, the payload is rendered directly.
   */
  async function renderViaTransition(
    url: string,
    perform: () => Promise<FetchResult>
  ): Promise<HeadElement[] | null> {
    if (deps.navigateTransition) {
      let headElements: HeadElement[] | null = null;
      await deps.navigateTransition(url, async (wrapPayload) => {
        const result = await perform();
        headElements = result.headElements;
        // Merge partial payload with cached segments before wrapping
        const merged = mergeAndCachePayload(result.payload, result.skippedSegments);
        // Store the MERGED payload in history — not the partial pre-merge tree.
        // This ensures handlePopState replays the complete tree on back/forward.
        historyStack.push(url, {
          payload: merged,
          headElements: result.headElements,
          params: result.params,
        });
        return wrapPayload(merged);
      });
      return headElements;
    }
    // Fallback: no transition (tests, no React tree)
    const result = await perform();
    // Merge partial payload with cached segments before rendering
    const merged = mergeAndCachePayload(result.payload, result.skippedSegments);
    // Store merged payload in history
    historyStack.push(url, {
      payload: merged,
      headElements: result.headElements,
      params: result.params,
    });
    renderPayload(merged);
    return result.headElements;
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

  /**
   * Core navigation logic shared between the transition and fallback paths.
   * Fetches the RSC payload, updates all state, and returns the result.
   */
  async function performNavigationFetch(
    url: string,
    options: { replace: boolean }
  ): Promise<FetchResult> {
    // Check prefetch cache first. PrefetchResult has optional segmentInfo/params
    // fields — normalize to null for FetchResult compatibility.
    const prefetched = prefetchCache.consume(url);
    let result: FetchResult | undefined = prefetched
      ? {
          payload: prefetched.payload,
          headElements: prefetched.headElements,
          segmentInfo: prefetched.segmentInfo ?? null,
          params: prefetched.params ?? null,
          skippedSegments: prefetched.skippedSegments ?? null,
        }
      : undefined;

    if (result === undefined) {
      // Fetch RSC payload with state tree for partial rendering.
      // Send current URL for intercepting route resolution (modal pattern).
      const stateTree = segmentCache.serializeStateTree(segmentElementCache.getMergeablePaths());
      const rawCurrentUrl = deps.getCurrentUrl();
      const currentUrl = rawCurrentUrl.startsWith('http')
        ? new URL(rawCurrentUrl).pathname
        : new URL(rawCurrentUrl, 'http://localhost').pathname;
      result = await fetchRscPayload(url, deps, stateTree, currentUrl);
    }

    // Update the browser history — replace mode overwrites the current entry
    if (options.replace) {
      deps.replaceState({ timber: true, scrollY: 0 }, '', url);
    } else {
      deps.pushState({ timber: true, scrollY: 0 }, '', url);
    }

    // NOTE: History push is deferred — the merged payload (after segment
    // merging in renderViaTransition) is stored by the caller, not here.
    // Storing result.payload here would record the partial (pre-merge)
    // RSC tree, causing handlePopState to replay an incomplete tree.

    // Update the segment cache with the new route's segment tree.
    updateSegmentCache(result.segmentInfo);

    // Update navigation state (params + pathname) before rendering.
    updateNavigationState(result.params, url);

    return result;
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
      const headElements = await renderViaTransition(url, () =>
        performNavigationFetch(url, { replace })
      );

      // Update document.title and <meta> tags with the new page's metadata
      applyHead(headElements);

      // Notify nuqs adapter (and any other listeners) that navigation completed.
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
      if (error instanceof RedirectError) {
        setPending(false);
        await navigate(error.redirectUrl, { replace: true });
        return;
      }
      // Abort errors are not application errors — swallow silently.
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
      const headElements = await renderViaTransition(currentUrl, async () => {
        // No state tree sent — server renders the complete RSC payload
        const result = await fetchRscPayload(currentUrl, deps);
        // History push handled by renderViaTransition (stores merged payload)
        updateSegmentCache(result.segmentInfo);
        updateNavigationState(result.params, currentUrl);
        return result;
      });

      applyHead(headElements);
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
        const headElements = await renderViaTransition(url, async () => {
          const stateTree = segmentCache.serializeStateTree(segmentElementCache.getMergeablePaths());
          const result = await fetchRscPayload(url, deps, stateTree);
          updateSegmentCache(result.segmentInfo);
          updateNavigationState(result.params, url);
          // History push handled by renderViaTransition (stores merged payload)
          return result;
        });

        applyHead(headElements);
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
    const stateTree = segmentCache.serializeStateTree(segmentElementCache.getMergeablePaths());
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
      // Cache segment elements for future partial merges.
      const currentUrl = deps.getCurrentUrl();
      const merged = mergeAndCachePayload(element, null);
      historyStack.push(currentUrl, {
        payload: merged,
        headElements,
      });
      renderPayload(merged);
      applyHead(headElements);
    },
    initSegmentCache: (segments: SegmentInfo[]) => updateSegmentCache(segments),
    cacheElementTree: (element: unknown) => cacheSegmentElements(element, segmentElementCache),
    segmentCache,
    prefetchCache,
    historyStack,
  };
}
