/**
 * Dev-mode warnings for common timber.js misuse patterns.
 *
 * These fire in development only and are stripped from production builds.
 * Each warning targets a specific misuse identified during design review.
 *
 * Warnings are deduplicated by a key (typically file path + warning type)
 * so the same warning is only emitted once per dev session.
 *
 * See design/02-rendering-pipeline.md §"Dev Warnings"
 * See design/06-caching.md §"Dev Warnings"
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration for dev warning behavior. */
export interface DevWarningConfig {
  /** Threshold in ms for "slow slot" warnings. Default: 200. */
  slowSlotThresholdMs?: number;
}

// ─── Deduplication ──────────────────────────────────────────────────────────

const _emitted = new Set<string>();

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/** Emit a warning only once per key. Returns true if emitted. */
function emitOnce(key: string, level: 'warn' | 'error', message: string): boolean {
  if (!isDev()) return false;
  if (_emitted.has(key)) return false;
  _emitted.add(key);
  console[level](message);
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
    `suspense-children:${layoutFile}`,
    'warn',
    `[timber] ${layoutFile}: <Suspense> wraps {children} in this layout. ` +
      'This defers the page content and prevents it from affecting the HTTP status code. ' +
      'Move <Suspense> inside the page to wrap specific slow content instead.'
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
    `deferred-suspense-children:${layoutFile}`,
    'warn',
    `[timber] ${layoutFile}: <DeferredSuspense> wraps {children} in this layout. ` +
      'This defers the page content and prevents it from affecting the HTTP status code. ' +
      'Move <DeferredSuspense> inside the page to wrap specific slow content instead.'
  );
}

/**
 * Warn when cookies() or headers() is called in a static build.
 *
 * In output: 'static' mode, there is no per-request context — these APIs
 * read build-time values only. This is almost always a mistake.
 *
 * @param api - The dynamic API name ("cookies" or "headers")
 * @param file - Relative path to the file calling the API
 */
export function warnDynamicApiInStaticBuild(api: 'cookies' | 'headers', file: string): void {
  emitOnce(
    `static-dynamic-api:${api}:${file}`,
    'error',
    `[timber] ${file}: ${api}() is not available in static builds (output: 'static'). ` +
      'There is no per-request context at build time. ' +
      "Remove this call or switch to output: 'server'."
  );
}

/**
 * Warn when redirect() is called in a slot's access.ts.
 *
 * Slots use deny() for graceful degradation. Redirecting from a slot would
 * redirect the entire page, breaking the contract that slot failure is
 * isolated to the slot.
 *
 * @param slotName - The slot name (e.g., "@admin")
 */
export function warnRedirectInSlotAccess(slotName: string): void {
  emitOnce(
    `slot-redirect:${slotName}`,
    'error',
    `[timber] redirect() is not allowed in slot ${slotName} access.ts. ` +
      'Slots use deny() for graceful degradation — denied.tsx → default.tsx → null. ' +
      "If you need to redirect, move the logic to the parent segment's access.ts."
  );
}

/**
 * Warn when deny() or redirect() is called inside a post-flush <Suspense> boundary.
 *
 * After the shell has flushed and the status code is committed, deny() and
 * redirect() cannot change the HTTP response. The signal will be caught by
 * the nearest error boundary instead of producing a correct status code.
 *
 * @param signal - The signal type ("deny" or "redirect")
 */
export function warnDenyAfterFlush(signal: 'deny' | 'redirect'): void {
  emitOnce(
    `post-flush-signal:${signal}`,
    'error',
    `[timber] ${signal}() was called inside a <Suspense> boundary after the status code was committed. ` +
      `The HTTP status is already sent — ${signal}() cannot change it. ` +
      `Move the ${signal}() call outside <Suspense> so it participates in the status code decision.`
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
    `slow-slot:${slotName}`,
    'warn',
    `[timber] slot ${slotName} resolved in ${durationMs}ms and is not wrapped in <Suspense>. ` +
      'Consider wrapping to avoid blocking the flush.'
  );
}

/**
 * Reset emitted warnings. For testing only.
 * @internal
 */
export function _resetWarnings(): void {
  _emitted.clear();
}
