/**
 * Browser Entry — Client-side hydration and navigation bootstrap.
 *
 * This is a real TypeScript file, not codegen. It initializes the
 * client navigation runtime: segment router, prefetch cache, and
 * history stack.
 *
 * Design docs: 18-build-system.md §"Entry Files", 19-client-navigation.md
 */

// @ts-expect-error — virtual module provided by timber-entries plugin
import config from 'virtual:timber-config';

import { createRouter } from './router.js';
import type { RouterDeps } from './router.js';

/**
 * Bootstrap the client-side runtime.
 *
 * Called once after hydration to initialize navigation interception,
 * prefetch handling, and history management.
 */
function bootstrap(runtimeConfig: typeof config): void {
  // TODO: Implement full hydration bootstrap.
  // Steps:
  // 1. Hydrate the React tree via hydrateRoot
  // 2. Create the router instance with browser deps
  // 3. Register popstate listener for back/forward
  // 4. Set up Link component's click interception
  // 5. Initialize prefetch cache from server-rendered state
  const _config = runtimeConfig;

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
