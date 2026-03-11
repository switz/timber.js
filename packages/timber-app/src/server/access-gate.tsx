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
import { getDevLogEmitter } from './dev-log-context.js';
import { withSpan, setSpanAttribute } from './tracing.js';

// Counter for generating unique dev log event IDs when no segment name is available.
let accessGateCounter = 0;

// ─── AccessGate ─────────────────────────────────────────────────────────────

/**
 * Framework-injected access gate for segments.
 *
 * Async server component that calls the segment's access.ts before rendering
 * children. If access.ts calls deny() or redirect(), the signal propagates
 * up as a render-phase throw. Because timber.js holds the flush until
 * onShellReady, the HTTP status code is correct.
 *
 * access.ts is a pure gate — return values are discarded. The layout below
 * gets the same data by calling the same cached functions (React.cache dedup).
 */
export async function AccessGate(props: AccessGateProps): Promise<ReactElement> {
  const { accessFn, params, searchParams, segmentName, children } = props;
  const label = `AccessGate (${segmentName ?? 'segment'})`;
  const eventId = `access-${segmentName ?? String(accessGateCounter++)}`;

  // Call access.ts wrapped in an OTEL span. If it calls deny() or redirect(),
  // a DenySignal or RedirectSignal is thrown — React catches it and the flush
  // controller produces the correct HTTP response.
  // The timber.result attribute is set after execution via setSpanAttribute
  // since the outcome is not known at span creation time.
  try {
    await withSpan('timber.access', { 'timber.segment': segmentName ?? 'unknown' }, async () => {
      try {
        await accessFn({ params, searchParams });
        await setSpanAttribute('timber.result', 'pass');
      } catch (error: unknown) {
        if (error instanceof DenySignal) {
          await setSpanAttribute('timber.result', 'deny');
        } else if (error instanceof RedirectSignal) {
          await setSpanAttribute('timber.result', 'redirect');
        }
        throw error;
      }
    });
  } catch (error: unknown) {
    // Emit access-result dev log event on denial
    const devEmitter = getDevLogEmitter();
    if (devEmitter) {
      const result =
        error instanceof DenySignal
          ? 'DENY'
          : error instanceof RedirectSignal
            ? 'REDIRECT'
            : 'ERROR';
      const status = error instanceof DenySignal ? error.status : undefined;
      devEmitter.emit({
        type: 'access-result',
        environment: 'rsc',
        label,
        id: eventId,
        parentId: 'render',
        meta: { result, status },
      });
    }
    throw error;
  }

  // Emit access-result dev log event on pass
  const devEmitter = getDevLogEmitter();
  if (devEmitter) {
    devEmitter.emit({
      type: 'access-result',
      environment: 'rsc',
      label,
      id: eventId,
      parentId: 'render',
      meta: { result: 'PASS' },
    });
  }

  // Access passed — render children (the layout and everything below).
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
