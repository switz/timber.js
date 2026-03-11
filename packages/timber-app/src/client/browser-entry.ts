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
 * - Manages history.scrollRestoration = 'manual' for scroll restoration
 * - Listens for popstate events for back/forward navigation
 *
 * Design docs: 18-build-system.md §"Entry Files", 19-client-navigation.md
 */

// @ts-expect-error — virtual module provided by timber-entries plugin
import config from 'virtual:timber-config';

import { createElement } from 'react';
import { hydrateRoot, createRoot, type Root } from 'react-dom/client';
import { createFromReadableStream, createFromFetch } from '@vitejs/plugin-rsc/browser';
import { createRouter } from './router.js';
import type { RouterDeps, RouterInstance } from './router.js';
import { applyHeadElements } from './head.js';
import { setGlobalRouter } from './router-ref.js';
import { TimberNuqsAdapter } from './nuqs-adapter.js';

// ─── Bootstrap ───────────────────────────────────────────────────

/**
 * Bootstrap the client-side runtime.
 *
 * Hydrates the server-rendered HTML with React, then initializes
 * client-side navigation for SPA transitions.
 */
function bootstrap(runtimeConfig: typeof config): void {
  const _config = runtimeConfig;

  // Take manual control of scroll restoration.
  // See design/19-client-navigation.md §"Scroll Restoration"
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

  let reactRoot: Root | null = null;
  let initialElement: unknown = null;

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
    function onDOMContentLoaded(): void {
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
    // Hydrate on document — the root layout renders the full <html> tree,
    // so React owns the entire document from the root.
    // Wrap with TimberNuqsAdapter so useQueryStates works out of the box.
    const wrapped = createElement(TimberNuqsAdapter, null, element as React.ReactNode);
    reactRoot = hydrateRoot(document, wrapped, {
      // Suppress recoverable hydration errors from deny/error signals
      // inside Suspense boundaries. The server already handled these
      // (wrapStreamWithErrorHandling closes the stream cleanly after
      // the shell is flushed). React replays the error during hydration
      // but the server HTML is already correct — no recovery needed.
      onRecoverableError(error: unknown) {
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
    reactRoot = createRoot(document);
  }

  // Initialize the client-side navigation router.
  const deps: RouterDeps = {
    fetch: (url, init) => window.fetch(url, init),
    pushState: (data, unused, url) => window.history.pushState(data, unused, url),
    replaceState: (data, unused, url) => window.history.replaceState(data, unused, url),
    scrollTo: (x, y) => window.scrollTo(x, y),
    getCurrentUrl: () => window.location.href,
    getScrollY: () => window.scrollY,

    // Decode RSC Flight stream using createFromFetch.
    // createFromFetch takes a Promise<Response> and progressively
    // parses the RSC stream as chunks arrive.
    decodeRsc: (fetchPromise: Promise<Response>) => {
      return createFromFetch(fetchPromise);
    },

    // Render decoded RSC tree into the hydrated React root.
    // Wrap with TimberNuqsAdapter to maintain nuqs context across navigations.
    renderRoot: (element: unknown) => {
      if (reactRoot) {
        const wrapped = createElement(TimberNuqsAdapter, null, element as React.ReactNode);
        reactRoot.render(wrapped);
      }
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

  const router = createRouter(deps);
  setGlobalRouter(router);

  // Store the initial page in the history stack so back-button works
  // after the first navigation. We store the decoded RSC element so
  // back navigation can replay it instantly without a server fetch.
  router.historyStack.push(window.location.href, {
    payload: initialElement,
    scrollY: 0,
    headElements: null, // SSR already set the correct head
  });

  // Register popstate handler for back/forward navigation
  window.addEventListener('popstate', () => {
    void router.handlePopState(window.location.href);
  });

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
}

// ─── Link Click Interception ─────────────────────────────────────

/**
 * Handle click events on timber links. Intercepts clicks on <a> elements
 * marked with data-timber-link and triggers SPA navigation instead of
 * a full page load.
 *
 * Passes through to default browser behavior when:
 * - Modified keys are held (Ctrl, Meta, Shift, Alt) — open in new tab
 * - The click is not the primary button
 * - The link has a target attribute (e.g., target="_blank")
 * - The link has a download attribute
 */
function handleLinkClick(event: MouseEvent, router: RouterInstance): void {
  // Only intercept primary clicks without modifier keys
  if (event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.defaultPrevented) return;

  // Find the closest <a> ancestor with data-timber-link
  const anchor = (event.target as Element).closest?.(
    'a[data-timber-link]'
  ) as HTMLAnchorElement | null;
  if (!anchor) return;

  // Don't intercept links that should open externally
  if (anchor.target && anchor.target !== '_self') return;
  if (anchor.hasAttribute('download')) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  // Prevent default navigation
  event.preventDefault();

  // Check scroll preference from data attribute
  const scroll = anchor.getAttribute('data-timber-scroll') !== 'false';

  // Trigger SPA navigation
  void router.navigate(href, { scroll });
}

// ─── Prefetch on Hover ───────────────────────────────────────────

/**
 * Handle mouseenter events on prefetch-enabled links. When the user
 * hovers over <a data-timber-prefetch>, the RSC payload is fetched
 * and cached for near-instant navigation.
 *
 * See design/19-client-navigation.md §"Prefetch Cache"
 */
function handleLinkHover(event: MouseEvent, router: RouterInstance): void {
  const anchor = (event.target as Element).closest?.(
    'a[data-timber-prefetch]'
  ) as HTMLAnchorElement | null;
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  router.prefetch(href);
}

bootstrap(config);
