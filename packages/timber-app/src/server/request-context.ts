/**
 * Request Context — per-request ALS store for headers() and cookies().
 *
 * Follows the same pattern as tracing.ts: a module-level AsyncLocalStorage
 * instance, public accessor functions that throw outside request scope,
 * and a framework-internal `runWithRequestContext()` to establish scope.
 *
 * See design/04-authorization.md §"AccessContext does not include cookies or headers"
 * and design/11-platform.md §"AsyncLocalStorage".
 * See design/29-cookies.md for cookie mutation semantics.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Routes } from '#/index.js';
import {
  requestContextAls,
  type RequestContextStore,
  type CookieEntry,
} from './als-registry.js';

// Re-export the ALS for framework-internal consumers that need direct access.
export { requestContextAls };

// No fallback needed — we use enterWith() instead of run() to ensure
// the ALS context persists for the entire request lifecycle including
// async stream consumption by React's renderToReadableStream.

// ─── Cookie Signing Secrets ──────────────────────────────────────────────

/**
 * Module-level cookie signing secrets. Index 0 is the newest (used for signing).
 * All entries are tried for verification (key rotation support).
 *
 * Set by the framework at startup via `setCookieSecrets()`.
 * See design/29-cookies.md §"Signed Cookies"
 */
let _cookieSecrets: string[] = [];

/**
 * Configure the cookie signing secrets.
 *
 * Called by the framework during server initialization with values from
 * `cookies.secret` or `cookies.secrets` in timber.config.ts.
 *
 * The first secret (index 0) is used for signing new cookies.
 * All secrets are tried for verification (supports key rotation).
 */
export function setCookieSecrets(secrets: string[]): void {
  _cookieSecrets = secrets.filter(Boolean);
}

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
 * Returns a cookie accessor for the current request.
 *
 * Available in middleware, access checks, server components, and server actions.
 * Throws if called outside a request context (security principle #2: no global fallback).
 *
 * Read methods (.get, .has, .getAll) are always available and reflect
 * read-your-own-writes from .set() calls in the same request.
 *
 * Mutation methods (.set, .delete, .clear) are only available in mutable
 * contexts (middleware.ts, server actions, route.ts handlers). Calling them
 * in read-only contexts (access.ts, server components) throws.
 *
 * See design/29-cookies.md
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
    get size(): number {
      return map.size;
    },

    getSigned(name: string): string | undefined {
      const raw = map.get(name);
      if (!raw || _cookieSecrets.length === 0) return undefined;
      return verifySignedCookie(raw, _cookieSecrets);
    },

    set(name: string, value: string, options?: CookieOptions): void {
      assertMutable(store, 'set');
      if (store.flushed) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[timber] warn: cookies().set('${name}') called after response headers were committed.\n` +
              `  The cookie will NOT be sent. Move cookie mutations to middleware.ts, a server action,\n` +
              `  or a route.ts handler.`
          );
        }
        return;
      }
      let storedValue = value;
      if (options?.signed) {
        if (_cookieSecrets.length === 0) {
          throw new Error(
            `[timber] cookies().set('${name}', ..., { signed: true }) requires ` +
              `cookies.secret or cookies.secrets in timber.config.ts.`
          );
        }
        storedValue = signCookieValue(value, _cookieSecrets[0]);
      }
      const opts = { ...DEFAULT_COOKIE_OPTIONS, ...options };
      store.cookieJar.set(name, { name, value: storedValue, options: opts });
      // Read-your-own-writes: update the parsed cookies map with the signed value
      // so getSigned() can verify it in the same request
      map.set(name, storedValue);
    },

    delete(name: string, options?: Pick<CookieOptions, 'path' | 'domain'>): void {
      assertMutable(store, 'delete');
      if (store.flushed) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[timber] warn: cookies().delete('${name}') called after response headers were committed.\n` +
              `  The cookie will NOT be deleted. Move cookie mutations to middleware.ts, a server action,\n` +
              `  or a route.ts handler.`
          );
        }
        return;
      }
      const opts: CookieOptions = {
        ...DEFAULT_COOKIE_OPTIONS,
        ...options,
        maxAge: 0,
        expires: new Date(0),
      };
      store.cookieJar.set(name, { name, value: '', options: opts });
      // Remove from read view
      map.delete(name);
    },

    clear(): void {
      assertMutable(store, 'clear');
      if (store.flushed) return;
      // Delete every incoming cookie
      for (const name of Array.from(map.keys())) {
        store.cookieJar.set(name, {
          name,
          value: '',
          options: { ...DEFAULT_COOKIE_OPTIONS, maxAge: 0, expires: new Date(0) },
        });
      }
      map.clear();
    },

    toString(): string {
      return Array.from(map.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
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

/** Options for setting a cookie. See design/29-cookies.md. */
export interface CookieOptions {
  /** Domain scope. Default: omitted (current domain only). */
  domain?: string;
  /** URL path scope. Default: '/'. */
  path?: string;
  /** Expiration date. Mutually exclusive with maxAge. */
  expires?: Date;
  /** Max age in seconds. Mutually exclusive with expires. */
  maxAge?: number;
  /** Prevent client-side JS access. Default: true. */
  httpOnly?: boolean;
  /** Only send over HTTPS. Default: true. */
  secure?: boolean;
  /** Cross-site request policy. Default: 'lax'. */
  sameSite?: 'strict' | 'lax' | 'none';
  /** Partitioned (CHIPS) — isolate cookie per top-level site. Default: false. */
  partitioned?: boolean;
  /**
   * Sign the cookie value with HMAC-SHA256 for integrity verification.
   * Requires `cookies.secret` or `cookies.secrets` in timber.config.ts.
   * See design/29-cookies.md §"Signed Cookies".
   */
  signed?: boolean;
}

const DEFAULT_COOKIE_OPTIONS: CookieOptions = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
};

/**
 * Cookie accessor returned by `cookies()`.
 *
 * Read methods are always available. Mutation methods throw in read-only
 * contexts (access.ts, server components).
 */
export interface RequestCookies {
  /** Get a cookie value by name. Returns undefined if not present. */
  get(name: string): string | undefined;
  /** Check if a cookie exists. */
  has(name: string): boolean;
  /** Get all cookies as an array of { name, value } pairs. */
  getAll(): Array<{ name: string; value: string }>;
  /** Number of cookies. */
  readonly size: number;
  /**
   * Get a signed cookie value, verifying its HMAC-SHA256 signature.
   * Returns undefined if the cookie is missing, the signature is invalid,
   * or no secrets are configured. Never throws.
   *
   * See design/29-cookies.md §"Signed Cookies"
   */
  getSigned(name: string): string | undefined;
  /** Set a cookie. Only available in mutable contexts (middleware, actions, route handlers). */
  set(name: string, value: string, options?: CookieOptions): void;
  /** Delete a cookie. Only available in mutable contexts. */
  delete(name: string, options?: Pick<CookieOptions, 'path' | 'domain'>): void;
  /** Delete all cookies. Only available in mutable contexts. */
  clear(): void;
  /** Serialize cookies as a Cookie header string. */
  toString(): string;
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
    cookieJar: new Map(),
    flushed: false,
    mutableContext: false,
  };
  return requestContextAls.run(store, fn);
}

/**
 * Enable cookie mutation for the current context. Called by the framework
 * when entering middleware.ts, server actions, or route.ts handlers.
 *
 * See design/29-cookies.md §"Context Tracking"
 */
export function setMutableCookieContext(mutable: boolean): void {
  const store = requestContextAls.getStore();
  if (store) {
    store.mutableContext = mutable;
  }
}

/**
 * Mark the response as flushed (headers committed). After this point,
 * cookie mutations log a warning instead of throwing.
 *
 * See design/29-cookies.md §"Streaming Constraint: Post-Flush Cookie Warning"
 */
export function markResponseFlushed(): void {
  const store = requestContextAls.getStore();
  if (store) {
    store.flushed = true;
  }
}

/**
 * Collect all Set-Cookie headers from the cookie jar.
 * Called by the framework at flush time to apply cookies to the response.
 *
 * Returns an array of serialized Set-Cookie header values.
 */
export function getSetCookieHeaders(): string[] {
  const store = requestContextAls.getStore();
  if (!store) return [];
  return Array.from(store.cookieJar.values()).map(serializeCookieEntry);
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

// ─── Cookie Helpers ───────────────────────────────────────────────────────

/** Throw if cookie mutation is attempted in a read-only context. */
function assertMutable(store: RequestContextStore, method: string): void {
  if (!store.mutableContext) {
    throw new Error(
      `[timber] cookies().${method}() cannot be called in this context.\n` +
        `  Set cookies in middleware.ts, server actions, or route.ts handlers.`
    );
  }
}

/**
 * Parse a Cookie header string into a Map of name → value pairs.
 * Follows RFC 6265 §4.2.1: cookies are semicolon-separated key=value pairs.
 */
function parseCookieHeader(header: string): Map<string, string> {
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

// ─── Cookie Signing ──────────────────────────────────────────────────────

/**
 * Sign a cookie value with HMAC-SHA256.
 * Returns `value.hex_signature`.
 */
function signCookieValue(value: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${signature}`;
}

/**
 * Verify a signed cookie value against an array of secrets.
 * Returns the original value if any secret produces a matching signature,
 * or undefined if none match. Uses timing-safe comparison.
 *
 * The signed format is `value.hex_signature` — split at the last `.`.
 */
function verifySignedCookie(raw: string, secrets: string[]): string | undefined {
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === raw.length - 1) return undefined;

  const value = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);

  // Hex-encoded SHA-256 is always 64 chars
  if (signature.length !== 64) return undefined;

  const signatureBuffer = Buffer.from(signature, 'hex');
  // If the hex decode produced fewer bytes, the signature was not valid hex
  if (signatureBuffer.length !== 32) return undefined;

  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(value).digest();
    if (timingSafeEqual(expected, signatureBuffer)) {
      return value;
    }
  }
  return undefined;
}

/** Serialize a CookieEntry into a Set-Cookie header value. */
function serializeCookieEntry(entry: CookieEntry): string {
  const parts = [`${entry.name}=${entry.value}`];
  const opts = entry.options;

  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.sameSite) {
    parts.push(`SameSite=${opts.sameSite.charAt(0).toUpperCase()}${opts.sameSite.slice(1)}`);
  }
  if (opts.partitioned) parts.push('Partitioned');

  return parts.join('; ');
}
