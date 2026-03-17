/**
 * AccessGate and SlotAccessGate — framework-injected async server components.
 *
 * AccessGate wraps each segment's layout in the element tree. It calls the
 * segment's access.ts before the layout renders. If access.ts calls deny()
 * or redirect(), the signal propagates as a render-phase throw — caught by
 * the flush controller to produce the correct HTTP status code.
 *
 * SlotAccessGate wraps parallel slot content. On denial, it renders the
 * graceful degradation chain: denied.tsx → default.tsx → null. Slot denial
 * does not affect the HTTP status code.
 *
 * See design/04-authorization.md and design/02-rendering-pipeline.md §"AccessGate"
 */

import { DenySignal, RedirectSignal } from './primitives.js';
import type { AccessGateProps, SlotAccessGateProps, ReactElement } from './tree-builder.js';
import { withSpan, setSpanAttribute } from './tracing.js';

// ─── AccessGate ─────────────────────────────────────────────────────────────

/**
 * Framework-injected access gate for segments.
 *
 * When a pre-computed `verdict` prop is provided (from the pre-render pass
 * in route-element-builder.ts), AccessGate replays it synchronously — no
 * async, no re-execution of access.ts, immune to Suspense timing. The OTEL
 * span was already emitted during the pre-render pass.
 *
 * When no verdict is provided (backward compat with tree-builder.ts),
 * AccessGate calls accessFn directly with OTEL instrumentation.
 *
 * access.ts is a pure gate — return values are discarded. The layout below
 * gets the same data by calling the same cached functions (React.cache dedup).
 */
export function AccessGate(props: AccessGateProps): ReactElement | Promise<ReactElement> {
  const { accessFn, params, searchParams, segmentName, verdict, children } = props;

  // Fast path: replay pre-computed verdict from the pre-render pass.
  // This is synchronous — Suspense boundaries cannot interfere with the
  // status code because the signal throws before any async work.
  if (verdict !== undefined) {
    if (verdict === 'pass') {
      return children;
    }
    // Throw the stored DenySignal or RedirectSignal synchronously.
    // React catches this as a render-phase throw — the flush controller
    // produces the correct HTTP status code.
    throw verdict;
  }

  // Fallback: call accessFn directly (used by tree-builder.ts which
  // doesn't run a pre-render pass, and for backward compat).
  return accessGateFallback(accessFn, params, searchParams, segmentName, children);
}

/**
 * Async fallback for AccessGate when no pre-computed verdict is available.
 * Calls accessFn with OTEL instrumentation.
 */
async function accessGateFallback(
  accessFn: AccessGateProps['accessFn'],
  params: AccessGateProps['params'],
  searchParams: AccessGateProps['searchParams'],
  segmentName: AccessGateProps['segmentName'],
  children: ReactElement
): Promise<ReactElement> {
  await withSpan('timber.access', { 'timber.segment': segmentName ?? 'unknown' }, async () => {
    try {
      await accessFn({ params, searchParams });
      await setSpanAttribute('timber.result', 'pass');
    } catch (error: unknown) {
      if (error instanceof DenySignal) {
        await setSpanAttribute('timber.result', 'deny');
        await setSpanAttribute('timber.deny_status', error.status);
        if (error.sourceFile) {
          await setSpanAttribute('timber.deny_file', error.sourceFile);
        }
      } else if (error instanceof RedirectSignal) {
        await setSpanAttribute('timber.result', 'redirect');
      }
      throw error;
    }
  });

  return children;
}

// ─── SlotAccessGate ─────────────────────────────────────────────────────────

/**
 * Framework-injected access gate for parallel slots.
 *
 * On denial, graceful degradation: denied.tsx → default.tsx → null.
 * The HTTP status code is unaffected — slot denial is a UI concern, not
 * a protocol concern. The parent layout and sibling slots still render.
 *
 * redirect() in slot access.ts is a dev-mode error — redirecting from a
 * slot doesn't make architectural sense.
 */
export async function SlotAccessGate(props: SlotAccessGateProps): Promise<ReactElement> {
  const { accessFn, params, searchParams, deniedFallback, defaultFallback, children } = props;

  try {
    await accessFn({ params, searchParams });
  } catch (error: unknown) {
    // DenySignal → graceful degradation (denied.tsx → default.tsx → null)
    if (error instanceof DenySignal) {
      return deniedFallback ?? defaultFallback ?? null;
    }

    // RedirectSignal in slot access → dev-mode error.
    // Slot access should use deny(), not redirect(). Redirecting from a
    // slot would redirect the entire page, which breaks the contract that
    // slot failure is graceful degradation.
    if (error instanceof RedirectSignal) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(
          '[timber] redirect() is not allowed in slot access.ts. ' +
            'Slots use deny() for graceful degradation — denied.tsx → default.tsx → null. ' +
            "If you need to redirect, move the logic to the parent segment's access.ts."
        );
      }
      // In production, treat as a deny — render fallback rather than crash.
      return deniedFallback ?? defaultFallback ?? null;
    }

    // Unhandled error — re-throw so error boundaries can catch it.
    // Dev-mode warning: slot access should use deny(), not throw.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[timber] Unhandled error in slot access.ts. ' +
          'Use deny() for access control, not unhandled throws.',
        error
      );
    }
    throw error;
  }

  // Access passed — render slot content.
  return children;
}
