// @timber/app/server — Server-side primitives
// These are the primary imports for server components, middleware, and access files.

export type { AccessContext } from './types';
export type { MiddlewareContext } from './types';
export type { RouteContext } from './types';
export type { Metadata, MetadataRoute } from './types';

// Request Context — ALS-backed headers(), cookies(), and searchParams()
// Design doc: design/04-authorization.md §"AccessContext does not include cookies or headers"
// Design doc: design/23-search-params.md §"Server Integration"
export {
  headers,
  cookies,
  searchParams,
  setParsedSearchParams,
  runWithRequestContext,
} from './request-context';
export type { ReadonlyHeaders, RequestCookies } from './request-context';

// Runtime primitives
export {
  deny,
  notFound,
  redirect,
  permanentRedirect,
  redirectExternal,
  RedirectType,
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

// Early Hints
export { collectEarlyHintHeaders, formatLinkHeader } from './early-hints';
export type { EarlyHint } from './early-hints';

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
  StatusFileFormat,
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
export {
  resolveMetadata,
  resolveTitle,
  resolveMetadataUrls,
  renderMetadataToElements,
} from './metadata';
export type { SegmentMetadataEntry, ResolveMetadataOptions, HeadElement } from './metadata';

// Metadata Routes
export {
  classifyMetadataRoute,
  getMetadataRouteServePath,
  getMetadataRouteAutoLink,
  METADATA_ROUTE_CONVENTIONS,
} from './metadata-routes';
export type { MetadataRouteInfo, MetadataRouteType } from './metadata-routes';

// Server Actions
export { createActionClient, ActionError, validated } from './action-client';
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

// FormData Preprocessing
export { parseFormData, coerce } from './form-data';

// Form Flash (no-JS error round-trip)
export { getFormFlash } from './form-flash';
export type { FormFlashData } from './form-flash';

// Revalidation
export {
  revalidatePath,
  revalidateTag,
  executeAction,
  buildNoJsResponse,
  isRscActionRequest,
} from './actions';
export type {
  RevalidateRenderer,
  RevalidationState,
  ActionHandlerConfig,
  ActionHandlerResult,
} from './actions';

// Tracing — per-request trace ID via ALS
// Design doc: design/17-logging.md §"trace_id is Always Set"
export {
  traceId,
  spanId,
  generateTraceId,
  runWithTraceId,
  replaceTraceId,
  withSpan,
  addSpanEvent,
} from './tracing';
export type { TraceStore } from './tracing';

// Logger — structured logging
// Design doc: design/17-logging.md §"Production Logging"
export { setLogger, getLogger } from './logger';
export {
  logRequestCompleted,
  logRequestReceived,
  logSlowRequest,
  logMiddlewareShortCircuit,
  logMiddlewareError,
  logRenderError,
  logProxyError,
  logWaitUntilUnsupported,
  logWaitUntilRejected,
  logSwrRefetchFailed,
  logCacheMiss,
} from './logger';
export type { TimberLogger } from './logger';

// Instrumentation — instrumentation.ts file convention
// Design doc: design/17-logging.md §"instrumentation.ts"
export { loadInstrumentation, callOnRequestError, hasOnRequestError } from './instrumentation';
export type {
  InstrumentationOnRequestError,
  InstrumentationRequestInfo,
  InstrumentationErrorContext,
} from './instrumentation';

// Dev Warnings — dev-mode misuse detection
// Design doc: design/21-dev-server.md §"Dev-Mode Warnings", design/11-platform.md §"Dev Mode"
export {
  warnSuspenseWrappingChildren,
  warnDenyInSuspense,
  warnRedirectInSuspense,
  warnRedirectInAccess,
  warnStaticRequestApi,
  warnCacheRequestProps,
  warnSlowSlotWithoutSuspense,
  setViteServer,
  WarningId,
  // Legacy aliases
  warnDynamicApiInStaticBuild,
  warnRedirectInSlotAccess,
  warnDenyAfterFlush,
} from './dev-warnings';
export type { DevWarningConfig } from './dev-warnings';

// Route Handler — route.ts API endpoints
// Design doc: design/07-routing.md §"route.ts — API Endpoints"
export { handleRouteRequest, resolveAllowedMethods } from './route-handler';
export type { RouteModule, RouteHandler, HttpMethod } from './route-handler';
