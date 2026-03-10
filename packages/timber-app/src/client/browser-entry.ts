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
 * Design docs: 18-build-system.md §"Entry Files", 19-client-navigation.md
 */

// @ts-expect-error — virtual module provided by timber-entries plugin
import config from 'virtual:timber-config';

import { hydrateRoot } from 'react-dom/client';
import { createFromReadableStream } from '@vitejs/plugin-rsc/browser';
import { createRouter } from './router.js';
import type { RouterDeps } from './router.js';

/**
 * Bootstrap the client-side runtime.
 *
 * Hydrates the server-rendered HTML with React, then initializes
 * client-side navigation for SPA transitions.
 */
function bootstrap(runtimeConfig: typeof config): void {
  const _config = runtimeConfig;

  // Hydrate the React tree from the RSC payload.
  // The RSC payload is embedded in the HTML as a script tag that
  // creates a ReadableStream. createFromReadableStream decodes
  // client component references and returns a React element tree.
  //
  // For the initial page load, the RSC payload is inlined in the HTML.
  // For subsequent navigations, it's fetched from the server.
  const rscPayload = (window as unknown as Record<string, unknown>).__TIMBER_RSC_PAYLOAD as
    | ReadableStream<Uint8Array>
    | undefined;

  if (rscPayload) {
    const element = createFromReadableStream(rscPayload);
    const root = document.getElementById('__timber');
    if (root) {
      hydrateRoot(root, element as React.ReactNode);
    }
  }

  // Initialize the client-side navigation router.
  const deps: RouterDeps = {
    fetch: (url, init) => window.fetch(url, init),
    pushState: (data, unused, url) => window.history.pushState(data, unused, url),
    replaceState: (data, unused, url) => window.history.replaceState(data, unused, url),
    scrollTo: (x, y) => window.scrollTo(x, y),
    getCurrentUrl: () => window.location.href,
    getScrollY: () => window.scrollY,
  };

  const _router = createRouter(deps);

  // Register popstate handler for back/forward navigation
  window.addEventListener('popstate', () => {
    void _router.handlePopState(window.location.href);
  });
}

bootstrap(config);
