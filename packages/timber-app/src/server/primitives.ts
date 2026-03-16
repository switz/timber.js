// Server-side primitives: deny, redirect, redirectExternal, RenderError, waitUntil
//
// These are the core runtime signals that components, middleware, and access gates
// use to control request flow. See design/10-error-handling.md.

// ─── DenySignal ─────────────────────────────────────────────────────────────

/**
 * Render-phase signal thrown by `deny()`. Caught by the framework to produce
 * the correct HTTP status code (segment context) or graceful degradation (slot context).
 */
export class DenySignal extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, data?: unknown) {
    super(`Access denied with status ${status}`);
    this.name = 'DenySignal';
    this.status = status;
    this.data = data;
  }

  /**
   * Extract the file that called deny() from the stack trace.
   * Returns a short path (e.g. "app/auth/access.ts") or undefined if
   * the stack can't be parsed. Dev-only — used for dev log output.
   */
  get sourceFile(): string | undefined {
    if (!this.stack) return undefined;
    const frames = this.stack.split('\n');
    // Skip the Error line and the deny() frame — the caller is the 3rd line.
    // Stack format: "    at FnName (file:line:col)" or "    at file:line:col"
    for (let i = 2; i < frames.length; i++) {
      const frame = frames[i];
      if (!frame) continue;
      // Skip framework internals
      if (frame.includes('primitives.ts') || frame.includes('node_modules')) continue;
      // Extract file path from the frame
      const match =
        frame.match(/\(([^)]+?)(?::\d+:\d+)\)/) ?? frame.match(/at\s+([^\s]+?)(?::\d+:\d+)/);
      if (match?.[1]) {
        // Shorten to app-relative path
        const full = match[1];
        const appIdx = full.indexOf('/app/');
        return appIdx >= 0 ? full.slice(appIdx + 1) : full;
      }
    }
    return undefined;
  }
}

/**
 * Universal denial primitive. Throws a `DenySignal` that the framework catches.
 *
 * - In segment context (outside Suspense): produces HTTP status code
 * - In slot context: graceful degradation → denied.tsx → default.tsx → null
 * - Inside Suspense (hold window): promoted to pre-flush behavior
 * - Inside Suspense (after flush): error boundary + noindex meta
 *
 * @param status - Any 4xx HTTP status code. Defaults to 403.
 * @param data - Optional data passed as `dangerouslyPassData` prop to status-code files.
 */
export function deny(status: number = 403, data?: unknown): never {
  if (status < 400 || status > 499) {
    throw new Error(
      `deny() requires a 4xx status code, got ${status}. ` +
        'For 5xx errors, throw a RenderError instead.'
    );
  }
  throw new DenySignal(status, data);
}

/**
 * Convenience alias for `deny(404)`.
 *
 * Provided for Next.js API compatibility — libraries and user code that
 * call `notFound()` from `next/navigation` get the same behavior as
 * `deny(404)` in timber.
 */
export function notFound(): never {
  throw new DenySignal(404);
}

/**
 * Next.js redirect type discriminator.
 *
 * Provided for API compatibility with libraries that import `RedirectType`
 * from `next/navigation`. In timber, `redirect()` always uses `replace`
 * semantics (no history entry for the redirect itself).
 */
export const RedirectType = {
  push: 'push',
  replace: 'replace',
} as const;

// ─── RedirectSignal ─────────────────────────────────────────────────────────

/**
 * Render-phase signal thrown by `redirect()` and `redirectExternal()`.
 * Caught by the framework to produce a 3xx response or client-side navigation.
 */
export class RedirectSignal extends Error {
  readonly location: string;
  readonly status: number;

  constructor(location: string, status: number) {
    super(`Redirect to ${location}`);
    this.name = 'RedirectSignal';
    this.location = location;
    this.status = status;
  }
}

/** Pattern matching absolute URLs: http(s):// or protocol-relative // */
const ABSOLUTE_URL_RE = /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/)/;

/**
 * Redirect to a relative path. Rejects absolute and protocol-relative URLs.
 * Use `redirectExternal()` for external redirects with an allow-list.
 *
 * @param path - Relative path (e.g. '/login', 'settings', '/login?returnTo=/dash')
 * @param status - HTTP redirect status code (3xx). Defaults to 302.
 */
export function redirect(path: string, status: number = 302): never {
  if (status < 300 || status > 399) {
    throw new Error(`redirect() requires a 3xx status code, got ${status}.`);
  }
  if (ABSOLUTE_URL_RE.test(path)) {
    throw new Error(
      `redirect() only accepts relative URLs. Got absolute URL: "${path}". ` +
        'Use redirectExternal(url, allowList) for external redirects.'
    );
  }
  throw new RedirectSignal(path, status);
}

/**
 * Permanent redirect to a relative path. Shorthand for `redirect(path, 308)`.
 *
 * Uses 308 (Permanent Redirect) which preserves the HTTP method — the browser
 * will replay POST requests to the new location. This matches Next.js behavior.
 *
 * @param path - Relative path (e.g. '/new-page', '/dashboard')
 */
export function permanentRedirect(path: string): never {
  redirect(path, 308);
}

/**
 * Redirect to an external URL. The hostname must be in the provided allow-list.
 *
 * @param url - Absolute URL to redirect to.
 * @param allowList - Array of allowed hostnames (e.g. ['example.com', 'auth.example.com']).
 * @param status - HTTP redirect status code (3xx). Defaults to 302.
 */
export function redirectExternal(url: string, allowList: string[], status: number = 302): never {
  if (status < 300 || status > 399) {
    throw new Error(`redirectExternal() requires a 3xx status code, got ${status}.`);
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`redirectExternal() received an invalid URL: "${url}"`);
  }

  if (!allowList.includes(hostname)) {
    throw new Error(
      `redirectExternal() target "${hostname}" is not in the allow-list. ` +
        `Allowed: [${allowList.join(', ')}]`
    );
  }

  throw new RedirectSignal(url, status);
}

// ─── RenderError ────────────────────────────────────────────────────────────

/**
 * Typed digest that crosses the RSC → client boundary.
 * The `code` identifies the error class; `data` carries JSON-serializable context.
 */
export interface RenderErrorDigest<TCode extends string = string, TData = unknown> {
  code: TCode;
  data: TData;
}

/**
 * Typed throw for render-phase errors that carry structured context to error boundaries.
 *
 * The `digest` (code + data) is serialized into the RSC stream separately from the
 * Error instance — only the digest crosses the RSC → client boundary.
 *
 * @example
 * ```ts
 * throw new RenderError('PRODUCT_NOT_FOUND', {
 *   title: 'Product not found',
 *   resourceId: params.id,
 * })
 * ```
 */
export class RenderError<TCode extends string = string, TData = unknown> extends Error {
  readonly code: TCode;
  readonly digest: RenderErrorDigest<TCode, TData>;
  readonly status: number;

  constructor(code: TCode, data: TData, options?: { status?: number }) {
    super(`RenderError: ${code}`);
    this.name = 'RenderError';
    this.code = code;
    this.digest = { code, data };

    const status = options?.status ?? 500;
    if (status < 400 || status > 599) {
      throw new Error(`RenderError status must be 4xx or 5xx, got ${status}.`);
    }
    this.status = status;
  }
}

// ─── waitUntil ──────────────────────────────────────────────────────────────

/** Minimal interface for adapters that support background work. */
export interface WaitUntilAdapter {
  waitUntil?(promise: Promise<unknown>): void;
}

// Intentional per-app singleton — warn-once flag that persists for the
// lifetime of the process/isolate. Not per-request; do not migrate to ALS.
let _waitUntilWarned = false;

/**
 * Register a promise to be kept alive after the response is sent.
 * Maps to `ctx.waitUntil()` on Cloudflare Workers and similar platforms.
 *
 * If the adapter does not support `waitUntil`, a warning is logged once
 * and the promise is left to resolve (or reject) without being tracked.
 *
 * @param promise - The background work to keep alive.
 * @param adapter - The platform adapter (injected by the framework at runtime).
 */
export function waitUntil(promise: Promise<unknown>, adapter: WaitUntilAdapter): void {
  if (typeof adapter.waitUntil === 'function') {
    adapter.waitUntil(promise);
    return;
  }

  if (!_waitUntilWarned) {
    _waitUntilWarned = true;
    console.warn(
      '[timber] waitUntil() is not supported by the current adapter. ' +
        'Background work will not be tracked. This warning is shown once.'
    );
  }
}

/**
 * Reset the waitUntil warning state. Exported for testing only.
 * @internal
 */
export function _resetWaitUntilWarning(): void {
  _waitUntilWarned = false;
}
