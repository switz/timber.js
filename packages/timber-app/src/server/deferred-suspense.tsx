// DeferredSuspense — hold the fallback for up to `ms` milliseconds.
//
// If children resolve within the hold window, no skeleton is ever shown —
// the content appears inline. If the deadline expires, the fallback flushes
// and children stream in later.
//
// Design doc: design/05-streaming.md §"DeferredSuspense"
//
// Implementation uses nested Suspense boundaries with a Delay component
// that itself suspends. This creates a natural race without any Promise.race
// in userland — it falls out of React's own boundary resolution logic.

import { Suspense, use, cache, type ReactNode } from 'react';

// cache() is critical — without it, the promise would be recreated on every
// React retry, resetting the timer forever. React 19's cache() is per-request
// on the server and per-render on the client — exactly the right scoping.
const getDelay = cache((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

function Delay({ ms, children }: { ms: number; children: ReactNode }) {
  use(getDelay(ms));
  return children;
}

export interface DeferredSuspenseProps {
  /** Milliseconds to wait before showing the fallback. This is a latency budget, not a guarantee. */
  ms: number;
  /** The fallback UI, same as <Suspense fallback={...}>. Shown only after `ms` expires. */
  fallback?: ReactNode;
  children?: ReactNode;
}

/**
 * Holds the fallback for up to `ms` milliseconds before showing it.
 *
 * If children resolve within the hold window, they render inline — no fallback
 * is ever shown. If the deadline expires, the fallback flushes and children
 * stream in when ready.
 *
 * The nested structure creates a natural race:
 * 1. Children suspend → inner boundary catches it, tries to render its fallback (Delay)
 * 2. Delay itself suspends for `ms` → outer boundary catches it, renders nothing
 * 3. If children resolve before `ms`: inner boundary resolves, Delay never renders, content appears inline
 * 4. If `ms` expires first: Delay resolves, inner fallback commits, real fallback UI appears — children stream in later
 */
export function DeferredSuspense({ ms, fallback, children }: DeferredSuspenseProps) {
  return (
    <Suspense fallback={fallback}>
      <Suspense fallback={<Delay ms={ms}>{fallback}</Delay>}>{children}</Suspense>
    </Suspense>
  );
}
