/**
 * Timber nuqs adapter — connects nuqs URL state management to timber's
 * RSC-aware client navigation.
 *
 * nuqs uses framework adapters to control how URL updates are applied.
 * This adapter implements nuqs's UseAdapterHook interface and:
 * - Calls router.navigate() for non-shallow updates (the default)
 * - Uses pushState/replaceState directly for shallow updates
 * - Sets timber defaults: shallow: false, scroll: true, history: 'push'
 *
 * Design doc: design/23-search-params.md §"Custom Adapter"
 */
'use client';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import {
  unstable_createAdapterProvider as createAdapterProvider,
  renderQueryString,
  type unstable_AdapterInterface as AdapterInterface,
  type unstable_AdapterOptions as AdapterOptions,
} from 'nuqs/adapters/custom';
import { getRouter } from './router-ref.js';

// ─── Adapter Hook ─────────────────────────────────────────────────

/**
 * Custom adapter hook for nuqs. Returns the current search params
 * and an updateUrl function that integrates with timber's router.
 *
 * @param _watchKeys - param keys this hook instance cares about
 *   (used by nuqs for selective re-rendering)
 */
function useTimberAdapter(_watchKeys: string[]): AdapterInterface {
  const [searchParams, setSearchParams] = useState(
    () => new URLSearchParams(window.location.search)
  );

  // Sync search params on popstate (back/forward) and after
  // timber navigations that change the URL.
  useEffect(() => {
    function sync() {
      setSearchParams(new URLSearchParams(window.location.search));
    }

    window.addEventListener('popstate', sync);
    // timber dispatches a custom event after client navigations complete
    window.addEventListener('timber:navigation-end', sync);

    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('timber:navigation-end', sync);
    };
  }, []);

  const updateUrl = useMemo(() => {
    return (search: URLSearchParams, options: Required<AdapterOptions>) => {
      const url = new URL(window.location.href);
      url.search = renderQueryString(search);

      if (options.shallow) {
        // Shallow: update URL only, no server roundtrip.
        const method =
          options.history === 'push' ? window.history.pushState : window.history.replaceState;
        method.call(window.history, window.history.state, '', url.toString());

        // Update local state to reflect the new URL
        setSearchParams(new URLSearchParams(url.search));
      } else {
        // Non-shallow (timber default): trigger RSC navigation to fetch
        // fresh server data for the new search params.
        const router = getRouter();
        void router.navigate(url.pathname + url.search + url.hash, {
          scroll: options.scroll,
          replace: options.history === 'replace',
        });
      }

      if (options.scroll) {
        window.scrollTo({ top: 0 });
      }
    };
  }, []);

  return {
    searchParams,
    updateUrl,
    getSearchParamsSnapshot: () => new URLSearchParams(window.location.search),
  };
}

// ─── Provider Component ───────────────────────────────────────────

// Lazily created — createAdapterProvider calls React.createElement internally,
// so it must NOT run at module scope. In Rolldown SSR bundles, React's
// __esmMin lazy initializer may not have run yet at module-init time.
let _TimberNuqsProvider: ReturnType<typeof createAdapterProvider> | undefined;

/**
 * Wraps the React tree with nuqs's adapter context, configured with
 * timber's default options.
 *
 * Auto-injected in browser-entry.ts — no user setup required.
 */
export function TimberNuqsAdapter({ children }: { children: ReactNode }) {
  const Provider = (_TimberNuqsProvider ??= createAdapterProvider(useTimberAdapter));
  return (
    <Provider
      defaultOptions={{
        shallow: false,
        scroll: true,
        clearOnDefault: true,
      }}
    >
      {children}
    </Provider>
  );
}
