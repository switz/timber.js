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

// ─── ALS Store ────────────────────────────────────────────────────────────

interface RequestContextStore {
  /** Incoming request headers (read-only view). */
  headers: Headers;
  /** Raw cookie header string, parsed lazily into a Map on first access. */
  cookieHeader: string;
  /** Lazily-parsed cookie map. */
  parsedCookies?: ReadonlyMap<string, string>;
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
  const store: RequestContextStore = {
    headers: req.headers,
    cookieHeader: req.headers.get('cookie') ?? '',
  };
  return requestContextAls.run(store, fn);
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
