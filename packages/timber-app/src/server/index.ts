// @timber/app/server — Server-side primitives
// These are the primary imports for server components, middleware, and access files.

export type { AccessContext } from './types';
export type { MiddlewareContext } from './types';
export type { RouteContext } from './types';
export type { Metadata, MetadataRoute } from './types';

// Runtime primitives
export {
  deny,
  redirect,
  redirectExternal,
  RenderError,
  waitUntil,
  DenySignal,
  RedirectSignal,
} from './primitives';
export type { RenderErrorDigest, WaitUntilAdapter } from './primitives';

// Pipeline
export { createPipeline } from './pipeline';
export type {
  PipelineConfig,
  RouteMatch,
  RouteMatcher,
  RouteRenderer,
  EarlyHintsEmitter,
} from './pipeline';

// Canonicalization
export { canonicalize } from './canonicalize';
export type { CanonicalizeResult } from './canonicalize';

// Proxy
export { runProxy } from './proxy';
export type { ProxyFn, ProxyExport } from './proxy';

// Middleware
export { runMiddleware } from './middleware-runner';
export type { MiddlewareFn } from './middleware-runner';

// Tree Builder
export { buildElementTree } from './tree-builder';
export type {
  TreeBuilderConfig,
  TreeBuildResult,
  LoadedModule,
  ModuleLoader,
  AccessGateProps,
  SlotAccessGateProps,
  ErrorBoundaryProps,
} from './tree-builder';

// Access Gates
export { AccessGate, SlotAccessGate } from './access-gate';

// Status-Code Resolver
export { resolveStatusFile, resolveSlotDenied } from './status-code-resolver';
export type {
  StatusFileResolution,
  StatusFileKind,
  SlotDeniedResolution,
  SlotDeniedKind,
} from './status-code-resolver';

// Flush Controller
export { flushResponse } from './flush';
export type { FlushOptions, FlushResult, RenderFn, RenderResult } from './flush';

// CSRF Protection
export { validateCsrf } from './csrf';
export type { CsrfConfig, CsrfResult } from './csrf';

// Body Limits
export { parseBodySize, enforceBodyLimits, DEFAULT_LIMITS } from './body-limits';
export type { BodyLimitsConfig, BodyLimitResult, BodyKind } from './body-limits';

// Metadata
export { resolveMetadata, resolveTitle, resolveMetadataUrls, renderMetadataToElements } from './metadata';
export type { SegmentMetadataEntry, ResolveMetadataOptions, HeadElement } from './metadata';

// Metadata Routes
export { classifyMetadataRoute, getMetadataRouteServePath, getMetadataRouteAutoLink, METADATA_ROUTE_CONVENTIONS } from './metadata-routes';
export type { MetadataRouteInfo, MetadataRouteType } from './metadata-routes';

// Server Actions
export { createActionClient, ActionError } from './action-client';
export type {
  ActionResult,
  ActionFn,
  ActionBuilder,
  ActionBuilderWithSchema,
  ActionContext,
  ActionMiddleware,
  ActionSchema,
  ValidationErrors,
} from './action-client';

// Revalidation
export { revalidatePath, revalidateTag, executeAction, buildNoJsResponse, isRscActionRequest } from './actions';
export type { RevalidateRenderer, RevalidationState, ActionHandlerConfig, ActionHandlerResult } from './actions';

// DeferredSuspense
// Design doc: design/05-streaming.md §"DeferredSuspense"
// Also exported from '@timber/app' for user-facing imports per design doc.
export { DeferredSuspense } from './deferred-suspense';
export type { DeferredSuspenseProps } from './deferred-suspense';
