/**
 * Dev-mode warnings for common timber.js misuse patterns.
 *
 * These fire in development only and are stripped from production builds.
 * Each warning targets a specific misuse identified during design review.
 *
 * Warnings are deduplicated by warningId:filePath:line so the same warning
 * is only emitted once per dev session (per unique source location).
 *
 * Warnings are written to stderr and, when a Vite dev server is available,
 * forwarded to the browser console via Vite's WebSocket.
 *
 * See design/21-dev-server.md §"Dev-Mode Warnings"
 * See design/11-platform.md §"Dev Mode"
 */

import type { ViteDevServer } from 'vite';

// ─── Warning IDs ───────────────────────────────────────────────────────────

export const WarningId = {
  SUSPENSE_WRAPS_CHILDREN: 'SUSPENSE_WRAPS_CHILDREN',
  DEFERRED_WRAPS_CHILDREN: 'DEFERRED_WRAPS_CHILDREN',
  DENY_IN_SUSPENSE: 'DENY_IN_SUSPENSE',
  REDIRECT_IN_SUSPENSE: 'REDIRECT_IN_SUSPENSE',
  REDIRECT_IN_ACCESS: 'REDIRECT_IN_ACCESS',
  STATIC_REQUEST_API: 'STATIC_REQUEST_API',
  CACHE_REQUEST_PROPS: 'CACHE_REQUEST_PROPS',
  SLOW_SLOT_NO_SUSPENSE: 'SLOW_SLOT_NO_SUSPENSE',
} as const;

export type WarningId = (typeof WarningId)[keyof typeof WarningId];

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration for dev warning behavior. */
export interface DevWarningConfig {
  /** Threshold in ms for "slow slot" warnings. Default: 200. */
  slowSlotThresholdMs?: number;
}

// ─── Deduplication & Server ─────────────────────────────────────────────────

const _emitted = new Set<string>();

/** Vite dev server for forwarding warnings to browser console. */
let _viteServer: ViteDevServer | null = null;

/**
 * Register the Vite dev server for browser console forwarding.
 * Called by timber-dev-server during configureServer.
 */
export function setViteServer(server: ViteDevServer | null): void {
  _viteServer = server;
}

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Emit a warning only once per dedup key.
 *
 * Writes to stderr and forwards to browser console via Vite WebSocket.
 * Returns true if emitted (not deduplicated).
 */
function emitOnce(
  warningId: WarningId,
  location: string,
  level: 'warn' | 'error',
  message: string
): boolean {
  if (!isDev()) return false;

  const dedupKey = `${warningId}:${location}`;
  if (_emitted.has(dedupKey)) return false;
  _emitted.add(dedupKey);

  // Write to stderr
  const prefix = level === 'error' ? '\x1b[31m[timber]\x1b[0m' : '\x1b[33m[timber]\x1b[0m';
  process.stderr.write(`${prefix} ${message}\n`);

  // Forward to browser console via Vite WebSocket
  if (_viteServer?.hot) {
    _viteServer.hot.send('timber:dev-warning', {
      warningId,
      level,
      message: `[timber] ${message}`,
    });
  }

  return true;
}

// ─── Warning Functions ──────────────────────────────────────────────────────

/**
 * Warn when a layout wraps {children} in <Suspense>.
 *
 * This defers the page content — the primary resource — behind a fallback.
 * The page's data fetches won't affect the HTTP status code because they
 * resolve after onShellReady. If the page calls deny(404), the status code
 * is already committed as 200.
 *
 * @param layoutFile - Relative path to the layout file (e.g., "app/(dashboard)/layout.tsx")
 */
export function warnSuspenseWrappingChildren(layoutFile: string): void {
  emitOnce(
    WarningId.SUSPENSE_WRAPS_CHILDREN,
    layoutFile,
    'warn',
    `Layout at ${layoutFile} wraps {children} in <Suspense>. ` +
      'This prevents child pages from setting HTTP status codes. ' +
      'Use useNavigationPending() for loading states instead.'
  );
}

/**
 * Warn when a layout wraps {children} in <DeferredSuspense>.
 *
 * Same issue as <Suspense> wrapping {children} — the page becomes deferred
 * content that cannot influence the HTTP status code.
 *
 * @param layoutFile - Relative path to the layout file
 */
export function warnDeferredSuspenseWrappingChildren(layoutFile: string): void {
  emitOnce(
    WarningId.DEFERRED_WRAPS_CHILDREN,
    layoutFile,
    'warn',
    `Layout at ${layoutFile} wraps {children} in <DeferredSuspense>. ` +
      'This prevents child pages from setting HTTP status codes. ' +
      'Use useNavigationPending() for loading states instead.'
  );
}

/**
 * Warn when deny() is called inside a Suspense boundary.
 *
 * After the shell has flushed and the status code is committed, deny()
 * cannot change the HTTP response. The signal will be caught by the nearest
 * error boundary instead of producing a correct status code.
 *
 * @param file - Relative path to the file
 * @param line - Line number where deny() was called
 */
export function warnDenyInSuspense(file: string, line?: number): void {
  const location = line ? `${file}:${line}` : file;
  emitOnce(
    WarningId.DENY_IN_SUSPENSE,
    location,
    'error',
    `deny() called inside <Suspense> at ${location}. ` +
      'The HTTP status is already committed — this will trigger an error boundary with a 200 status. ' +
      'Move deny() outside <Suspense> for correct HTTP semantics.'
  );
}

/**
 * Warn when redirect() is called inside a Suspense boundary.
 *
 * This will perform a client-side navigation instead of an HTTP redirect.
 *
 * @param file - Relative path to the file
 * @param line - Line number where redirect() was called
 */
export function warnRedirectInSuspense(file: string, line?: number): void {
  const location = line ? `${file}:${line}` : file;
  emitOnce(
    WarningId.REDIRECT_IN_SUSPENSE,
    location,
    'error',
    `redirect() called inside <Suspense> at ${location}. ` +
      'This will perform a client-side navigation instead of an HTTP redirect.'
  );
}

/**
 * Warn when redirect() is called in a slot's access.ts.
 *
 * Slots use deny() for graceful degradation. Redirecting from a slot would
 * redirect the entire page, breaking the contract that slot failure is
 * isolated to the slot.
 *
 * @param accessFile - Relative path to the access.ts file
 * @param line - Line number where redirect() was called
 */
export function warnRedirectInAccess(accessFile: string, line?: number): void {
  const location = line ? `${accessFile}:${line}` : accessFile;
  emitOnce(
    WarningId.REDIRECT_IN_ACCESS,
    location,
    'error',
    `redirect() called in access.ts at ${location}. ` +
      'Only deny() is valid in slot access checks. ' +
      'Use deny() to block access or move redirect() to middleware.ts.'
  );
}

/**
 * Warn when cookies() or headers() is called during a static build.
 *
 * In output: 'static' mode, there is no per-request context — these APIs
 * read build-time values only. This is almost always a mistake.
 *
 * @param api - The dynamic API name ("cookies" or "headers")
 * @param file - Relative path to the file calling the API
 */
export function warnStaticRequestApi(api: 'cookies' | 'headers', file: string): void {
  emitOnce(
    WarningId.STATIC_REQUEST_API,
    `${api}:${file}`,
    'error',
    `${api}() called during static generation of ${file}. ` +
      'Dynamic request APIs are not available during prerendering.'
  );
}

/**
 * Warn when a "use cache" component receives request-specific props.
 *
 * Cached components should not depend on per-request data — a userId or
 * sessionId in the props means the cache will either be ineffective
 * (key per user) or dangerous (serve one user's data to another).
 *
 * @param componentName - Name of the cached component
 * @param propName - Name of the suspicious prop
 * @param file - Relative path to the component file
 * @param line - Line number
 */
export function warnCacheRequestProps(
  componentName: string,
  propName: string,
  file: string,
  line?: number
): void {
  const location = line ? `${file}:${line}` : file;
  emitOnce(
    WarningId.CACHE_REQUEST_PROPS,
    `${componentName}:${propName}:${location}`,
    'warn',
    `Cached component ${componentName} receives prop "${propName}" which appears request-specific. ` +
      'Cached components should not depend on per-request data.'
  );
}

/**
 * Warn when a parallel slot resolves slowly without a <Suspense> wrapper.
 *
 * A slow slot without Suspense blocks onShellReady — and therefore the
 * status code commit — for the entire page. Wrapping it in <Suspense>
 * lets the shell flush without waiting for the slot.
 *
 * @param slotName - The slot name (e.g., "@admin")
 * @param durationMs - How long the slot took to resolve
 */
export function warnSlowSlotWithoutSuspense(slotName: string, durationMs: number): void {
  emitOnce(
    WarningId.SLOW_SLOT_NO_SUSPENSE,
    slotName,
    'warn',
    `Slot ${slotName} resolved in ${durationMs}ms and is not wrapped in <Suspense>. ` +
      'Consider wrapping to avoid blocking the flush.'
  );
}

// ─── Legacy aliases ─────────────────────────────────────────────────────────

/** @deprecated Use warnStaticRequestApi instead */
export const warnDynamicApiInStaticBuild = warnStaticRequestApi;

/** @deprecated Use warnRedirectInAccess instead */
export function warnRedirectInSlotAccess(slotName: string): void {
  warnRedirectInAccess(`${slotName}/access.ts`);
}

/** @deprecated Use warnDenyInSuspense / warnRedirectInSuspense instead */
export function warnDenyAfterFlush(signal: 'deny' | 'redirect'): void {
  if (signal === 'deny') {
    warnDenyInSuspense('unknown');
  } else {
    warnRedirectInSuspense('unknown');
  }
}

// ─── Testing ────────────────────────────────────────────────────────────────

/**
 * Reset emitted warnings. For testing only.
 * @internal
 */
export function _resetWarnings(): void {
  _emitted.clear();
}

/**
 * Get the set of emitted dedup keys. For testing only.
 * @internal
 */
export function _getEmitted(): ReadonlySet<string> {
  return _emitted;
}
