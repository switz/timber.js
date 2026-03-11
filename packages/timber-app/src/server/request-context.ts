/**
 * Request Context — per-request ALS store for headers() and cookies().
 *
 * Follows the same pattern as tracing.ts: a module-level AsyncLocalStorage
 * instance, public accessor functions that throw outside request scope,
 * and a framework-internal `runWithRequestContext()` to establish scope.
 *
 * See design/04-authorization.md §"AccessContext does not include cookies or headers"
 * and design/11-platform.md §"AsyncLocalStorage".
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Routes } from '../index.js';

// ─── ALS Store ────────────────────────────────────────────────────────────

interface RequestContextStore {
  /** Incoming request headers (read-only view). */
  headers: Headers;
  /** Raw cookie header string, parsed lazily into a Map on first access. */
  cookieHeader: string;
  /** Lazily-parsed cookie map. */
  parsedCookies?: ReadonlyMap<string, string>;
  /** Original (pre-overlay) frozen headers, kept for overlay merging. */
  originalHeaders: Headers;
  /**
   * Promise resolving to the route's typed search params (when search-params.ts
   * exists) or to the raw URLSearchParams. Stored as a Promise so the framework
   * can later support partial pre-rendering where param resolution is deferred.
   */
  searchParamsPromise: Promise<URLSearchParams | Record<string, unknown>>;
}

const requestContextAls = new AsyncLocalStorage<RequestContextStore>();

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Returns a read-only view of the current request's headers.
 *
 * Available in middleware, access checks, server components, and server actions.
 * Throws if called outside a request context (security principle #2: no global fallback).
 */
export function headers(): ReadonlyHeaders {
  const store = requestContextAls.getStore();
  if (!store) {
    throw new Error(
      '[timber] headers() called outside of a request context. ' +
        'It can only be used in middleware, access checks, server components, and server actions.'
    );
  }
  return store.headers;
}

/**
 * Returns a read-only cookie map for the current request.
 *
 * Available in middleware, access checks, server components, and server actions.
 * Throws if called outside a request context (security principle #2: no global fallback).
 *
 * The returned object has `.get(name)`, `.has(name)`, and `.getAll()` methods.
 */
export function cookies(): RequestCookies {
  const store = requestContextAls.getStore();
  if (!store) {
    throw new Error(
      '[timber] cookies() called outside of a request context. ' +
        'It can only be used in middleware, access checks, server components, and server actions.'
    );
  }

  // Parse cookies lazily on first access
  if (!store.parsedCookies) {
    store.parsedCookies = parseCookieHeader(store.cookieHeader);
  }

  const map = store.parsedCookies;
  return {
    get(name: string): string | undefined {
      return map.get(name);
    },
    has(name: string): boolean {
      return map.has(name);
    },
    getAll(): Array<{ name: string; value: string }> {
      return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
    },
  };
}

/**
 * Returns a Promise resolving to the current request's search params.
 *
 * In `page.tsx`, `middleware.ts`, and `access.ts` the framework pre-parses the
 * route's `search-params.ts` definition and the Promise resolves to the typed
 * object. In all other server component contexts it resolves to raw
 * `URLSearchParams`.
 *
 * Returned as a Promise to match the `params` prop convention and to allow
 * future partial pre-rendering support where param resolution may be deferred.
 *
 * Throws if called outside a request context.
 */
export function searchParams<R extends keyof Routes>(): Promise<Routes[R]['searchParams']>;
export function searchParams(): Promise<URLSearchParams | Record<string, unknown>>;
export function searchParams(): Promise<URLSearchParams | Record<string, unknown>> {
  const store = requestContextAls.getStore();
  if (!store) {
    throw new Error(
      '[timber] searchParams() called outside of a request context. ' +
        'It can only be used in middleware, access checks, server components, and server actions.'
    );
  }
  return store.searchParamsPromise;
}

/**
 * Replace the search params Promise for the current request with one that
 * resolves to the typed parsed result from the route's search-params.ts.
 * Called by the framework before rendering the page — not for app code.
 */
export function setParsedSearchParams(parsed: Record<string, unknown>): void {
  const store = requestContextAls.getStore();
  if (store) {
    store.searchParamsPromise = Promise.resolve(parsed);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Read-only Headers interface. The standard Headers class is mutable;
 * this type narrows it to read-only methods. The underlying object is
 * still a Headers instance, but user code should not mutate it.
 */
export type ReadonlyHeaders = Pick<
  Headers,
  'get' | 'has' | 'entries' | 'keys' | 'values' | 'forEach' | typeof Symbol.iterator
>;

/**
 * Read-only cookie accessor returned by `cookies()`.
 */
export interface RequestCookies {
  /** Get a cookie value by name. Returns undefined if not present. */
  get(name: string): string | undefined;
  /** Check if a cookie exists. */
  has(name: string): boolean;
  /** Get all cookies as an array of { name, value } pairs. */
  getAll(): Array<{ name: string; value: string }>;
}

// ─── Framework-Internal Helpers ───────────────────────────────────────────

/**
 * Run a callback within a request context. Used by the pipeline to establish
 * per-request ALS scope so that `headers()` and `cookies()` work.
 *
 * @param req - The incoming Request object.
 * @param fn - The function to run within the request context.
 */
export function runWithRequestContext<T>(req: Request, fn: () => T): T {
  const originalCopy = new Headers(req.headers);
  const store: RequestContextStore = {
    headers: freezeHeaders(req.headers),
    originalHeaders: originalCopy,
    cookieHeader: req.headers.get('cookie') ?? '',
    searchParamsPromise: Promise.resolve(new URL(req.url).searchParams),
  };
  return requestContextAls.run(store, fn);
}

/**
 * Apply middleware-injected request headers to the current request context.
 *
 * Called by the pipeline after middleware.ts runs. Merges overlay headers
 * on top of the original request headers so downstream code (access.ts,
 * server components, server actions) sees them via `headers()`.
 *
 * The original request headers are never mutated — a new frozen Headers
 * object is created with the overlay applied on top.
 *
 * See design/07-routing.md §"Request Header Injection"
 */
export function applyRequestHeaderOverlay(overlay: Headers): void {
  const store = requestContextAls.getStore();
  if (!store) {
    throw new Error('[timber] applyRequestHeaderOverlay() called outside of a request context.');
  }

  // Check if the overlay has any headers — skip if empty
  let hasOverlay = false;
  overlay.forEach(() => {
    hasOverlay = true;
  });
  if (!hasOverlay) return;

  // Merge: start with original headers, overlay on top
  const merged = new Headers(store.originalHeaders);
  overlay.forEach((value, key) => {
    merged.set(key, value);
  });
  store.headers = freezeHeaders(merged);
}

// ─── Read-Only Headers ────────────────────────────────────────────────────

const MUTATING_METHODS = new Set(['set', 'append', 'delete']);

/**
 * Wrap a Headers object in a Proxy that throws on mutating methods.
 * Object.freeze doesn't work on Headers (native internal slots), so we
 * intercept property access and reject set/append/delete at runtime.
 *
 * Read methods (get, has, entries, etc.) must be bound to the underlying
 * Headers instance because they access private #headersList slots.
 */
function freezeHeaders(source: Headers): Headers {
  const copy = new Headers(source);
  return new Proxy(copy, {
    get(target, prop) {
      if (typeof prop === 'string' && MUTATING_METHODS.has(prop)) {
        return () => {
          throw new Error(
            `[timber] headers() returns a read-only Headers object. ` +
              `Calling .${prop}() is not allowed. ` +
              `Use ctx.requestHeaders in middleware to inject headers for downstream components.`
          );
        };
      }
      const value = Reflect.get(target, prop);
      // Bind methods to the real Headers instance so private slot access works
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

// ─── Cookie Parser ────────────────────────────────────────────────────────

/**
 * Parse a Cookie header string into a Map of name → value pairs.
 * Follows RFC 6265 §4.2.1: cookies are semicolon-separated key=value pairs.
 */
function parseCookieHeader(header: string): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;

  for (const pair of header.split(';')) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const name = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (name) {
      map.set(name, value);
    }
  }

  return map;
}
