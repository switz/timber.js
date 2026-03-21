/**
 * Centralized AsyncLocalStorage registry for server-side per-request state.
 *
 * ALL ALS instances used by the server framework live here. Individual
 * modules (request-context.ts, tracing.ts, actions.ts, etc.) import from
 * this registry and re-export public accessor functions.
 *
 * Why: ALS instances require singleton semantics — if two copies of the
 * same ALS exist (one from a relative import, one from a barrel import),
 * one module writes to its copy and another reads from an empty copy.
 * Centralizing ALS creation in a single module eliminates this class of bug.
 *
 * The `timber-shims` plugin ensures `@timber-js/app/server` resolves to
 * src/ in RSC and SSR environments, so all import paths converge here.
 *
 * DO NOT create ALS instances outside this file. If you need a new ALS,
 * add it here and import from `./als-registry.js` in the consuming module.
 *
 * See design/18-build-system.md §"Module Singleton Strategy" and
 * §"Singleton State Registry".
 */

import { AsyncLocalStorage } from 'node:async_hooks';

// ─── Request Context ──────────────────────────────────────────────────────
// Used by: request-context.ts (headers(), cookies(), searchParams())
// Design doc: design/04-authorization.md

/** @internal — import via request-context.ts public API */
export const requestContextAls = new AsyncLocalStorage<RequestContextStore>();

export interface RequestContextStore {
  /** Incoming request headers (read-only view). */
  headers: Headers;
  /** Raw cookie header string, parsed lazily into a Map on first access. */
  cookieHeader: string;
  /** Lazily-parsed cookie map (mutable — reflects write-overlay from set()). */
  parsedCookies?: Map<string, string>;
  /** Original (pre-overlay) frozen headers, kept for overlay merging. */
  originalHeaders: Headers;
  /**
   * Promise resolving to the route's typed search params (when search-params.ts
   * exists) or to the raw URLSearchParams. Stored as a Promise so the framework
   * can later support partial pre-rendering where param resolution is deferred.
   */
  searchParamsPromise: Promise<URLSearchParams | Record<string, unknown>>;
  /** Outgoing Set-Cookie entries (name → serialized value + options). Last write wins. */
  cookieJar: Map<string, CookieEntry>;
  /** Whether the response has flushed (headers committed). */
  flushed: boolean;
  /** Whether the current context allows cookie mutation. */
  mutableContext: boolean;
}

/** A single outgoing cookie entry in the cookie jar. */
export interface CookieEntry {
  name: string;
  value: string;
  options: import('./request-context.js').CookieOptions;
}

// ─── Tracing ──────────────────────────────────────────────────────────────
// Used by: tracing.ts (traceId(), spanId())
// Design doc: design/17-logging.md

export interface TraceStore {
  /** 32-char lowercase hex trace ID (OTEL or UUID fallback). */
  traceId: string;
  /** OTEL span ID if available, undefined otherwise. */
  spanId?: string;
}

/** @internal — import via tracing.ts public API */
export const traceAls = new AsyncLocalStorage<TraceStore>();

// ─── Server-Timing ────────────────────────────────────────────────────────
// Used by: server-timing.ts (recordTiming(), withTiming())
// Design doc: (dev-only performance instrumentation)

export interface TimingStore {
  entries: import('./server-timing.js').TimingEntry[];
}

/** @internal — import via server-timing.ts public API */
export const timingAls = new AsyncLocalStorage<TimingStore>();

// ─── Revalidation ─────────────────────────────────────────────────────────
// Used by: actions.ts (revalidatePath(), revalidateTag())
// Design doc: design/08-forms-and-actions.md

export interface RevalidationState {
  /** Paths to re-render (populated by revalidatePath calls). */
  paths: string[];
  /** Tags to invalidate (populated by revalidateTag calls). */
  tags: string[];
}

/** @internal — import via actions.ts public API */
export const revalidationAls = new AsyncLocalStorage<RevalidationState>();

// ─── Form Flash ───────────────────────────────────────────────────────────
// Used by: form-flash.ts (getFormFlash())
// Design doc: design/08-forms-and-actions.md §"No-JS Error Round-Trip"

/** @internal — import via form-flash.ts public API */
export const formFlashAls = new AsyncLocalStorage<import('./form-flash.js').FormFlashData>();

// ─── Early Hints Sender ──────────────────────────────────────────────────
// Used by: early-hints-sender.ts (sendEarlyHints103())
// Design doc: design/02-rendering-pipeline.md §"Early Hints (103)"

/** Function that sends Link header values as a 103 Early Hints response. */
export type EarlyHintsSenderFn = (links: string[]) => void;

/** @internal — import via early-hints-sender.ts public API */
export const earlyHintsSenderAls = new AsyncLocalStorage<EarlyHintsSenderFn>();

// ─── waitUntil Bridge ────────────────────────────────────────────────────
// Used by: waituntil-bridge.ts (waitUntil())
// Design doc: design/11-platform.md §"waitUntil()"

/** Function that extends the request lifecycle with a background promise. */
export type WaitUntilFn = (promise: Promise<unknown>) => void;

/** @internal — import via waituntil-bridge.ts public API */
export const waitUntilAls = new AsyncLocalStorage<WaitUntilFn>();
