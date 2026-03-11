/**
 * Server-side nuqs adapter provider for SSR rendering.
 *
 * During SSR, `'use client'` components that call nuqs hooks (useQueryStates,
 * useQueryState) need the nuqs adapter context. The client adapter
 * (TimberNuqsAdapter) relies on `window` and React hooks that are
 * client-only. This provider supplies a static, SSR-safe adapter
 * that feeds the current request's search params into the nuqs context.
 *
 * The returned component wraps the React tree so that nuqs hooks render
 * the correct initial values during server-side rendering. On the client,
 * TimberNuqsAdapter (injected by browser-entry.ts) takes over.
 *
 * Design doc: design/23-search-params.md §"Custom Adapter"
 */

import { createElement, type ReactNode } from 'react';
import {
  unstable_createAdapterProvider as createAdapterProvider,
  type unstable_AdapterInterface as AdapterInterface,
} from 'nuqs/adapters/custom';

// ─── SSR Adapter ──────────────────────────────────────────────────

/**
 * Create a nuqs adapter provider for SSR that serves a static snapshot
 * of search params. The `updateUrl` is a no-op because URL updates
 * cannot happen on the server.
 */
function makeNuqsSsrAdapter(searchParams: URLSearchParams) {
  function useNuqsSsrAdapter(_watchKeys: string[]): AdapterInterface {
    return {
      searchParams,
      updateUrl: () => {},
      getSearchParamsSnapshot: () => searchParams,
    };
  }

  return createAdapterProvider(useNuqsSsrAdapter);
}

// ─── Provider Component ───────────────────────────────────────────

/**
 * Wrap the SSR element tree with a nuqs adapter context.
 *
 * Called by ssr-entry.ts before passing the element to renderSsrStream.
 * Takes the NavContext search params and provides them to nuqs hooks
 * running during SSR so they render with the correct initial values.
 *
 * @param searchParamsRecord - The request's search params as a plain record
 * @param children - The React element tree to wrap
 */
export function withNuqsSsrAdapter(
  searchParamsRecord: Record<string, string>,
  children: ReactNode
): ReactNode {
  const searchParams = new URLSearchParams(searchParamsRecord);
  const Provider = makeNuqsSsrAdapter(searchParams);
  // AdapterProvider types require children in the props object (not as 3rd arg)
  // eslint-disable-next-line react/no-children-prop
  return createElement(Provider, { defaultOptions: { shallow: false, scroll: true }, children });
}
