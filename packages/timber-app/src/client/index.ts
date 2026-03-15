// @timber/app/client — Client-side primitives
// These are the primary imports for client components.

export type { RenderErrorDigest } from './types';

// Navigation
export { Link, interpolateParams, resolveHref, validateLinkHref, buildLinkProps } from './link';
export type { LinkProps, LinkPropsWithHref, LinkPropsWithParams } from './link';
export type { OnNavigateHandler, OnNavigateEvent } from './link-navigate-interceptor';
export { createRouter } from './router';
export type {
  RouterInstance,
  NavigationOptions,
  RouterDeps,
  RscDecoder,
  RootRenderer,
} from './router';
export { useNavigationPending } from './use-navigation-pending';
export { useLinkStatus, LinkStatusContext } from './use-link-status';
export type { LinkStatus } from './use-link-status';
export { getRouter } from './router-ref';
export { useRouter } from './use-router';
export type { AppRouterInstance } from './use-router';
export { usePathname } from './use-pathname';
export { useSearchParams } from './use-search-params';
export { useSelectedLayoutSegment, useSelectedLayoutSegments } from './use-selected-layout-segment';

// Segment context (internal, used by rsc-entry to inject layout position)
export { SegmentProvider, useSegmentContext } from './segment-context';
export type { SegmentContextValue } from './segment-context';

// Segment cache (internal, but exported for advanced use)
export { SegmentCache, PrefetchCache } from './segment-cache';
export type { SegmentNode, StateTree } from './segment-cache';

// History (internal, but exported for advanced use)
export { HistoryStack } from './history';
export type { HistoryEntry } from './history';

// Forms
export { useActionState, useFormAction, useFormErrors } from './form';
export type { UseActionStateFn, UseActionStateReturn, FormErrorsResult } from './form';

// Params
export { useParams, setCurrentParams } from './use-params';

// Query states (URL-synced search params)
export { useQueryStates, bindUseQueryStates } from './use-query-states';

// Cookies
export { useCookie, setServerCookieSnapshot } from './use-cookie';
export type { ClientCookieOptions, CookieSetter } from './use-cookie';

// Error boundary (framework-internal, used by tree-builder and rsc-entry)
export { TimberErrorBoundary } from './error-boundary';
export type { TimberErrorBoundaryProps } from './error-boundary';
