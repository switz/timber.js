// @timber/app/server — Server-side primitives
// These are the primary imports for server components, middleware, and access files.

export type { AccessContext } from './types'
export type { MiddlewareContext } from './types'
export type { RouteContext } from './types'
export type { Metadata, MetadataRoute } from './types'

// Runtime primitives
export {
  deny,
  redirect,
  redirectExternal,
  RenderError,
  waitUntil,
  DenySignal,
  RedirectSignal,
} from './primitives'
export type { RenderErrorDigest, WaitUntilAdapter } from './primitives'

// Pipeline
export { createPipeline } from './pipeline'
export type { PipelineConfig, RouteMatch, RouteMatcher, RouteRenderer, EarlyHintsEmitter } from './pipeline'

// Canonicalization
export { canonicalize } from './canonicalize'
export type { CanonicalizeResult } from './canonicalize'

// Proxy
export { runProxy } from './proxy'
export type { ProxyFn, ProxyExport } from './proxy'

// Middleware
export { runMiddleware } from './middleware-runner'
export type { MiddlewareFn } from './middleware-runner'
