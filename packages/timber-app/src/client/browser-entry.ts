/**
 * Browser Entry — Client-side hydration and navigation bootstrap.
 *
 * This is a real TypeScript file, not codegen. It initializes the
 * client navigation runtime: segment router, prefetch cache, and
 * history stack.
 *
 * Hydration works by:
 * 1. Decoding the RSC payload embedded in the initial HTML response
 *    via createFromReadableStream from @vitejs/plugin-rsc/browser
 * 2. Hydrating the decoded React tree via hydrateRoot
 * 3. Setting up client-side navigation for subsequent page transitions
 *
 * After hydration, the browser entry:
 * - Intercepts clicks on <a data-timber-link> for SPA navigation
 * - Listens for mouseenter on <a data-timber-prefetch> for hover prefetch
 * - Listens for popstate events for back/forward navigation
 *
 * Design docs: 18-build-system.md §"Entry Files", 19-client-navigation.md
 */

// @ts-expect-error — virtual module provided by timber-entries plugin
import config from 'virtual:timber-config';

import { createElement } from 'react';
import { hydrateRoot, createRoot, type Root } from 'react-dom/client';
import {
  createFromReadableStream,
  createFromFetch,
  setServerCallback,
  encodeReply,
} from '#/rsc-runtime/browser.js';
// Shared-state modules MUST be imported from @timber-js/app/client (the public
// barrel) so they resolve to the same module instances as user code. In Vite dev,
// user code imports @timber-js/app/client from dist/ via package.json exports.
// If we used relative imports (./router-ref.js), Vite would load separate src/
// copies with separate module-level state — e.g., globalRouter set here but
// read as null from the dist/ copy used by useRouter().
import { createRouter, setGlobalRouter, getRouter, setCurrentParams } from '@timber-js/app/client';
import type { RouterDeps, RouterInstance } from '@timber-js/app/client';

// Internal-only modules (no shared mutable state with user code) use relative
// imports — they don't need singleton behavior across module graphs.
import { applyHeadElements } from './head.js';
import { TimberNuqsAdapter } from './nuqs-adapter.js';
import { isPageUnloading } from './unload-guard.js';
import {
  NavigationProvider,
  getNavigationState,
  setNavigationState,
} from './navigation-context.js';
import { setupServerLogReplay, setupClientErrorForwarding } from './browser-dev.js';
import { handleLinkClick, handleLinkHover } from './browser-links.js';
import { TransitionRoot, transitionRender, navigateTransition } from './transition-root.js';

// ─── Server Action Dispatch ──────────────────────────────────────

/**
 * Register the callServer callback for server action dispatch.
 *
 * When React encounters a server reference (from `'use server'` modules),
 * it calls `callServer(id, args)` to dispatch the action to the server.
 * The RSC plugin delegates to `globalThis.__viteRscCallServer` which is
 * set by `setServerCallback`.
 *
 * The callback:
 * 1. Serializes args via `encodeReply` (RSC wire format)
 * 2. POSTs to the current URL with `Accept: text/x-component`
 * 3. Decodes the RSC response stream
 *
 * See design/08-forms-and-actions.md §"Client-Side Form Mechanics"
 */
setServerCallback(async (id: string, args: unknown[]) => {
  const body = await encodeReply(args);

  // Track the X-Timber-Revalidation header from the response.
  // We intercept the fetch promise to read headers before createFromFetch
  // consumes the body stream.
  let hasRevalidation = false;
  let hasRedirect = false;
  let headElementsJson: string | null = null;

  const response = fetch(window.location.href, {
    method: 'POST',
    headers: {
      'Accept': 'text/x-component',
      'x-rsc-action': id,
    },
    body,
  }).then((res) => {
    hasRevalidation = res.headers.get('X-Timber-Revalidation') === '1';
    hasRedirect = res.headers.get('X-Timber-Redirect') != null;
    headElementsJson = res.headers.get('X-Timber-Head');
    return res;
  });

  const decoded = await createFromFetch(response);

  // Handle redirect — server encoded the redirect location in the RSC stream
  // instead of returning HTTP 302. Perform a client-side SPA navigation.
  if (hasRedirect) {
    const wrapper = decoded as { _redirect: string; _status: number };
    try {
      const router = getRouter();
      void router.navigate(wrapper._redirect);
    } catch {
      // Router not yet initialized — fall back to full navigation
      window.location.href = wrapper._redirect;
    }
    return undefined;
  }

  if (hasRevalidation) {
    // Piggybacked response: wrapper object { _action, _tree }
    // Apply the revalidated tree directly — no separate router.refresh() needed.
    const wrapper = decoded as { _action: unknown; _tree: unknown };
    try {
      const router = getRouter();
      const headElements = headElementsJson ? JSON.parse(headElementsJson) : null;
      router.applyRevalidation(wrapper._tree, headElements);
    } catch {
      // Router not yet initialized — fall through
    }
    return wrapper._action;
  }

  // No piggybacked revalidation — refresh to pick up any mutations.
  // This covers actions that don't call revalidatePath().
  try {
    const router = getRouter();
    void router.refresh();
  } catch {
    // Router not yet initialized (rare edge case during bootstrap)
  }

  return decoded;
});

// ─── Bootstrap ───────────────────────────────────────────────────

/**
 * Bootstrap the client-side runtime.
 *
 * Hydrates the server-rendered HTML with React, then initializes
 * client-side navigation for SPA transitions.
 */
/** Read scroll position from window or scroll containers. */
function getScrollY(): number {
  if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop;
  }
  for (const el of document.querySelectorAll('[data-timber-scroll-restoration]')) {
    if ((el as HTMLElement).scrollTop > 0) return (el as HTMLElement).scrollTop;
  }
  // Auto-detect: if window isn't scrolled, check for overflow containers.
  // Common pattern: layouts use a scrollable div (overflow-y: auto/scroll)
  // inside a fixed-height parent (h-screen). In this case window.scrollY is
  // always 0 and the real scroll position lives on the overflow container.
  const container = findOverflowContainer();
  if (container && container.scrollTop > 0) return container.scrollTop;
  return 0;
}

/**
 * Find the primary overflow scroll container in the document.
 *
 * Walks direct children of body and their immediate children looking for
 * an element with overflow-y: auto|scroll that is actually scrollable
 * (scrollHeight > clientHeight). Returns the first match, or null.
 *
 * This heuristic covers the common layout patterns:
 *   <body> → <html-wrapper> → <div class="overflow-y-auto">
 *   <body> → <main class="overflow-y-auto">
 *
 * We limit depth to avoid expensive full-tree traversals.
 *
 * DIVERGENCE FROM NEXT.JS: Next.js's ScrollAndFocusHandler scrolls only
 * document.documentElement.scrollTop — it does NOT handle overflow containers.
 * Layouts using h-screen + overflow-y-auto have the same scroll bug in Next.js.
 * This heuristic is a deliberate improvement. The tradeoff is fragility: depth-2
 * traversal may miss deeply nested containers or match the wrong element.
 * See design/19-client-navigation.md §"Overflow Scroll Containers".
 */
function findOverflowContainer(): HTMLElement | null {
  const candidates: HTMLElement[] = [];
  // Check body's direct children and their children (depth 2)
  for (const child of document.body.children) {
    candidates.push(child as HTMLElement);
    for (const grandchild of child.children) {
      candidates.push(grandchild as HTMLElement);
    }
  }
  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
  }
  return null;
}

function bootstrap(runtimeConfig: typeof config): void {
  const _config = runtimeConfig;

  // Take manual control of scroll restoration. React's render() on the
  // document root resets scroll during DOM reconciliation, so the browser's
  // native scroll restoration (scrollRestoration = 'auto') doesn't work —
  // the browser restores scroll, then React's commit resets it to 0.
  // We save/restore scroll positions explicitly in the history stack.
  window.history.scrollRestoration = 'manual';

  // Hydrate the React tree from the RSC payload.
  //
  // The RSC payload is embedded in the HTML as progressive inline script
  // tags that call self.__timber_f.push([type, data]) as RSC chunks arrive.
  // Typed tuples: [0] = bootstrap signal, [1, string] = Flight data chunk.
  //
  // We set up a ReadableStream fed by those push() calls so
  // createFromReadableStream can decode the Flight protocol progressively.
  //
  // For the initial page load, the RSC payload is inlined in the HTML.
  // For subsequent navigations, it's fetched from the server.
  type FlightSegment = [isBootstrap: 0] | [isData: 1, data: string];

  const timberChunks = (self as unknown as Record<string, FlightSegment[]>).__timber_f;

  let _reactRoot: Root | null = null;
  let initialElement: unknown = null;
  // Declared here so it's accessible after the if/else hydration block.
  // Assigned inside initRouter() which is called in both branches.
  let router!: RouterInstance;

  if (timberChunks) {
    const encoder = new TextEncoder();

    // Buffer to hold string data until the stream writer is ready.
    // Scripts that execute before hydration starts push data here.
    let dataBuffer: string[] | undefined = [];
    let streamWriter: ReadableStreamDefaultController<Uint8Array> | null = null;
    let streamFlushed = false;

    /** Process a typed tuple from __timber_f. */
    function handleSegment(seg: FlightSegment): void {
      if (seg[0] === 0) {
        // Bootstrap signal — initialize buffer (already done above)
        if (!dataBuffer) dataBuffer = [];
      } else if (seg[0] === 1) {
        // Flight data chunk
        if (streamWriter) {
          streamWriter.enqueue(encoder.encode(seg[1]));
        } else if (dataBuffer) {
          dataBuffer.push(seg[1]);
        }
      }
    }

    // Process any chunks that arrived before this script executed.
    for (const seg of timberChunks) {
      handleSegment(seg);
    }
    // Clear the array to release memory.
    timberChunks.length = 0;

    // Patch push() so subsequent script tags feed data in real time.
    (timberChunks as unknown as { push: (seg: FlightSegment) => void }).push = handleSegment;

    const rscPayload = new ReadableStream<Uint8Array>({
      start(controller) {
        streamWriter = controller;
        // Flush buffered data into the stream.
        if (dataBuffer) {
          for (const data of dataBuffer) {
            controller.enqueue(encoder.encode(data));
          }
          dataBuffer = undefined;
        }
        // If DOM already loaded (non-streaming or fast page), close now.
        if (streamFlushed) {
          controller.close();
        }
      },
    });

    // Close the stream when the document finishes loading.
    // DOMContentLoaded fires after the HTML parser has processed all
    // inline scripts (including streamed Suspense replacements and
    // RSC data), so all push() calls have completed by this point.
    //
    // If the page is unloading (user refreshed or navigated away),
    // do NOT close the stream. When the connection drops mid-stream,
    // DOMContentLoaded fires because the parser finishes. Closing an
    // incomplete RSC stream causes React's Flight client to throw
    // "Connection closed." — a jarring error on a page being replaced.
    // Leaving the stream open is harmless: the page is being torn down.
    function onDOMContentLoaded(): void {
      if (isPageUnloading()) return;
      if (streamWriter && !streamFlushed) {
        streamWriter.close();
        streamFlushed = true;
        dataBuffer = undefined;
      }
      streamFlushed = true;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDOMContentLoaded, false);
    } else {
      // DOM already parsed — close after a microtask to ensure
      // any pending push() calls from inline scripts have executed.
      setTimeout(onDOMContentLoaded);
    }

    const element = createFromReadableStream(rscPayload);
    initialElement = element;

    // ── Initialize the navigation router BEFORE hydration ──────────────
    // hydrateRoot() synchronously executes component render functions.
    // Components that call useRouter() during render need the global
    // router to be available, otherwise they get a stale no-op reference.
    // The router must be initialized before hydration so useRouter() works.
    // renderRoot uses transitionRender (no direct reactRoot dependency).
    initRouter();

    // ── Initialize navigation state BEFORE hydration ───────────────────
    // Read server-embedded params and set navigation state so that
    // useParams() and usePathname() return correct values during hydration.
    // This must happen before hydrateRoot so the NavigationProvider
    // wrapping the element has the right values on the initial render.
    const earlyParams = (self as unknown as Record<string, unknown>).__timber_params;
    if (earlyParams && typeof earlyParams === 'object') {
      setCurrentParams(earlyParams as Record<string, string | string[]>);
      setNavigationState({
        params: earlyParams as Record<string, string | string[]>,
        pathname: window.location.pathname,
      });
      delete (self as unknown as Record<string, unknown>).__timber_params;
    } else {
      setNavigationState({
        params: {},
        pathname: window.location.pathname,
      });
    }

    // Hydrate on document — the root layout renders the full <html> tree,
    // so React owns the entire document from the root.
    // Wrap with NavigationProvider (for atomic useParams/usePathname),
    // TimberNuqsAdapter (for nuqs context), and TransitionRoot (for
    // transition-based rendering during client navigation).
    //
    // TransitionRoot holds the element in React state and updates via
    // startTransition, so React keeps old UI visible while new Suspense
    // boundaries resolve during navigation. See design/05-streaming.md.
    const navState = getNavigationState();
    const withNav = createElement(
      NavigationProvider,
      { value: navState },
      element as React.ReactNode
    );
    const wrapped = createElement(TimberNuqsAdapter, null, withNav);
    const rootElement = createElement(TransitionRoot, { initial: wrapped });
    _reactRoot = hydrateRoot(document, rootElement, {
      // Suppress recoverable hydration errors from deny/error signals
      // inside Suspense boundaries. The server already handled these
      // (wrapStreamWithErrorHandling closes the stream cleanly after
      // the shell is flushed). React replays the error during hydration
      // but the server HTML is already correct — no recovery needed.
      onRecoverableError(error: unknown) {
        // Suppress errors during page unload (refresh/navigate away).
        // The aborted stream causes incomplete HTML which React flags
        // as a recoverable error — but the page is being replaced.
        if (isPageUnloading()) return;
        // Only log in dev — in production these are expected for
        // deny() inside Suspense and streaming error boundaries.
        if (process.env.NODE_ENV === 'development') {
          console.debug('[timber] Hydration recoverable error:', error);
        }
      },
    });
  } else {
    // No RSC payload available (plugin hasn't inlined it yet) — create a
    // non-hydrated root so client navigation can still render RSC payloads.
    // The initial SSR HTML remains as-is; the first client navigation will
    // replace it with a React-managed tree.
    initRouter();
    _reactRoot = createRoot(document);
  }

  // ── Router initialization (hoisted above hydrateRoot) ────────────────
  // Extracted into a function so both the hydration and createRoot paths
  // can call it. Must run before hydrateRoot so useRouter() works during
  // the initial render. renderRoot uses transitionRender which is set
  // by the TransitionRoot component during hydration.
  function initRouter(): void {
    const deps: RouterDeps = {
      fetch: (url, init) => window.fetch(url, init),
      pushState: (data, unused, url) => window.history.pushState(data, unused, url),
      replaceState: (data, unused, url) => window.history.replaceState(data, unused, url),
      scrollTo: (x, y) => {
        window.scrollTo(x, y);
        document.documentElement.scrollTop = y;
        document.body.scrollTop = y;
        // Also scroll any element explicitly marked as a scroll container.
        for (const el of document.querySelectorAll('[data-timber-scroll-restoration]')) {
          (el as HTMLElement).scrollTop = y;
        }
        // Auto-detect overflow containers for layouts that scroll inside
        // a fixed-height wrapper (e.g., h-screen + overflow-y-auto).
        // In these layouts, window.scrollY is always 0 and the real scroll
        // lives on the overflow container. Without this, forward navigation
        // between pages that share a layout with parallel route slots won't
        // scroll to top — the router's window.scrollTo(0,0) is a no-op.
        const container = findOverflowContainer();
        if (container) {
          container.scrollTop = y;
        }
      },
      getCurrentUrl: () => window.location.pathname + window.location.search,
      getScrollY,

      // Decode RSC Flight stream using createFromFetch.
      // createFromFetch takes a Promise<Response> and progressively
      // parses the RSC stream as chunks arrive.
      decodeRsc: (fetchPromise: Promise<Response>) => {
        return createFromFetch(fetchPromise);
      },

      // Render decoded RSC tree via TransitionRoot's state-based mechanism.
      // Used for non-navigation renders (popstate cached replay, applyRevalidation).
      // Wraps with NavigationProvider + TimberNuqsAdapter.
      //
      // For navigation renders (navigate, refresh, popstate-with-fetch),
      // navigateTransition is used instead — it wraps the entire navigation
      // in a React transition with useOptimistic for the pending URL.
      renderRoot: (element: unknown) => {
        const navState = getNavigationState();
        const withNav = createElement(
          NavigationProvider,
          { value: navState },
          element as React.ReactNode
        );
        const wrapped = createElement(TimberNuqsAdapter, null, withNav);
        transitionRender(wrapped);
      },

      // Run a navigation inside a React transition with optimistic pending URL.
      // The entire fetch + state update runs inside startTransition. useOptimistic
      // shows the pending URL immediately and reverts to null when the transition
      // commits (atomic with the new tree + params).
      //
      // The perform callback receives a wrapPayload function that wraps the
      // decoded RSC payload with NavigationProvider + NuqsAdapter — this must
      // happen inside the transition so the NavigationProvider reads the
      // UPDATED navigation state (set by the router inside perform).
      navigateTransition: (pendingUrl: string, perform) => {
        return navigateTransition(pendingUrl, async () => {
          const payload = await perform((rawPayload: unknown) => {
            const navState = getNavigationState();
            const withNav = createElement(
              NavigationProvider,
              { value: navState },
              rawPayload as React.ReactNode
            );
            return createElement(TimberNuqsAdapter, null, withNav);
          });
          return payload as React.ReactNode;
        });
      },

      // Schedule a callback after the next paint so scroll operations
      // happen after React commits the new content to the DOM.
      // Double-rAF ensures the browser has painted the new frame.
      afterPaint: (callback: () => void) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(callback);
        });
      },

      // Apply resolved head elements (title, meta tags) to the DOM after
      // SPA navigation. See design/16-metadata.md.
      applyHead: applyHeadElements,
    };

    router = createRouter(deps);
    setGlobalRouter(router);
  }

  // Store the initial page in the history stack so back-button works
  // after the first navigation. We store the decoded RSC element so
  // back navigation can replay it instantly without a server fetch.
  router.historyStack.push(window.location.pathname + window.location.search, {
    payload: initialElement,
    headElements: null, // SSR already set the correct head
  });

  // Initialize history.state with scrollY for the initial entry.
  // This ensures back navigation to the initial page restores scroll correctly.
  window.history.replaceState({ timber: true, scrollY: 0 }, '');

  // Populate the segment cache from server-embedded segment metadata.
  // This enables state tree diffing from the very first client navigation.
  // See design/19-client-navigation.md §"X-Timber-State-Tree Header"
  const timberSegments = (self as unknown as Record<string, unknown>).__timber_segments;
  if (Array.isArray(timberSegments)) {
    router.initSegmentCache(timberSegments);
    delete (self as unknown as Record<string, unknown>).__timber_segments;
  }

  // Note: __timber_params is read before hydrateRoot (see above) so that
  // NavigationProvider has correct values during hydration. If the hydration
  // path was skipped (no RSC payload), populate the fallback here.
  const lateTimberParams = (self as unknown as Record<string, unknown>).__timber_params;
  if (lateTimberParams && typeof lateTimberParams === 'object') {
    setCurrentParams(lateTimberParams as Record<string, string | string[]>);
    setNavigationState({
      params: lateTimberParams as Record<string, string | string[]>,
      pathname: window.location.pathname,
    });
    delete (self as unknown as Record<string, unknown>).__timber_params;
  }

  // Register popstate handler for back/forward navigation.
  // Use pathname+search (not full href) to match the URL format used by
  // navigate() — Link hrefs are relative paths like "/scroll-test/page-a".
  // Read scrollY from history.state — the browser maintains per-entry state
  // so duplicate URLs in history each have their own scroll position.
  window.addEventListener('popstate', () => {
    const state = window.history.state;
    const scrollY = state && typeof state.scrollY === 'number' ? state.scrollY : 0;
    void router.handlePopState(window.location.pathname + window.location.search, scrollY);
  });

  // Keep history.state.scrollY up to date as the user scrolls.
  // This ensures that when the user presses back/forward, the departing
  // page's scroll position is already saved in its history entry.
  // Debounced to avoid excessive replaceState calls during smooth scrolling.
  let scrollTimer: ReturnType<typeof setTimeout>;
  function saveScrollPosition(): void {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const state = window.history.state;
      if (state && typeof state === 'object') {
        // Use getScrollY to capture scroll from overflow containers too.
        window.history.replaceState({ ...state, scrollY: getScrollY() }, '');
      }
    }, 100);
  }
  window.addEventListener('scroll', saveScrollPosition, { passive: true });

  // Delegate click events on <a data-timber-link> for SPA navigation.
  // Uses event delegation on document for efficiency — no per-link listeners.
  document.addEventListener('click', (event: MouseEvent) => {
    handleLinkClick(event, router);
  });

  // Delegate mouseenter events on <a data-timber-prefetch> for hover prefetch.
  // Uses capture phase to detect mouseenter on nested elements.
  document.addEventListener(
    'mouseenter',
    (event: MouseEvent) => {
      handleLinkHover(event, router);
    },
    true // capture phase — mouseenter doesn't bubble
  );

  // Dev-only: Listen for RSC module invalidation events from @vitejs/plugin-rsc.
  // When a server component is edited, the RSC plugin sends an "rsc:update"
  // event. We trigger a router.refresh() to re-fetch the RSC payload with
  // the updated server code. This avoids a full page reload while still
  // picking up server-side changes.
  // See design/21-dev-server.md §"HMR Wiring"
  // Vite injects import.meta.hot in dev mode. Cast to access it without
  // requiring vite/client types in the package tsconfig.
  const hot = (
    import.meta as unknown as {
      hot?: {
        on(event: string, cb: (...args: unknown[]) => void): void;
        send(event: string, data: unknown): void;
      };
    }
  ).hot;
  if (hot) {
    hot.on('rsc:update', () => {
      void router.refresh();
    });

    // Listen for dev warnings forwarded from the server via WebSocket.
    // See dev-warnings.ts — emitOnce() sends these via server.hot.send().
    hot.on('timber:dev-warning', (data: unknown) => {
      const warning = data as { level: string; message: string };
      if (warning.level === 'error') {
        console.error(warning.message);
      } else {
        console.warn(warning.message);
      }
    });

    // Listen for server console logs forwarded via WebSocket.
    // Replays them in the browser console with a [SERVER] prefix
    // so developers can see server output without switching to the terminal.
    // See plugins/dev-logs.ts.
    setupServerLogReplay(hot);

    // Forward uncaught client errors to the server for the dev overlay.
    // The server source-maps the stack and sends it back via Vite's
    // error overlay protocol. See dev-server.ts §client error listener.
    setupClientErrorForwarding(hot);
  }
}

bootstrap(config);

// Signal that the client runtime has been initialized.
// Used by E2E tests to wait for hydration before interacting.
// We append a <meta name="timber-ready"> tag rather than setting a
// data attribute on <html>. Since React owns the entire document
// via hydrateRoot(document, ...), mutating <html> attributes causes
// hydration mismatch warnings. Dynamically-added <meta> tags don't
// conflict because React doesn't reconcile them.
const readyMeta = document.createElement('meta');
readyMeta.name = 'timber-ready';
document.head.appendChild(readyMeta);
