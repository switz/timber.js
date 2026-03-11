// DeferredSuspense — wraps children in a Suspense boundary.
//
// Design doc: design/05-streaming.md §"DeferredSuspense"
//
// TODO: Restore the nested-Suspense "hold fallback for N ms" behavior once
// @vitejs/plugin-rsc fixes the Flight→Fizz interaction that triggers
// "A previously unvisited boundary must have exactly one root segment"
// with nested Suspense boundaries. The nested pattern works in plain React
// but breaks when the RSC Flight stream is decoded by Vite's vendored
// Flight client and then rendered by Fizz.
//
// Original design: outer <Suspense> catches inner fallback suspension,
// inner <Suspense> wraps children with a <Delay ms={ms}> fallback that
// itself suspends via use(). This creates a natural race — if children
// resolve before the delay, no fallback is shown; if the delay resolves
// first, the fallback flushes and children stream in later.

import { Suspense, type ReactNode } from 'react';

export interface DeferredSuspenseProps {
  /** Milliseconds to wait before showing the fallback. Currently unused — see TODO above. */
  ms: number;
  /** The fallback UI, same as <Suspense fallback={...}>. */
  fallback?: ReactNode;
  children?: ReactNode;
}

/**
 * Suspense boundary with a deferred fallback.
 *
 * Currently behaves as a plain <Suspense> — the `ms` prop is accepted but
 * the hold-delay behavior is disabled due to an upstream bug in
 * @vitejs/plugin-rsc's Flight client with nested Suspense boundaries.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function DeferredSuspense({ ms, fallback, children }: DeferredSuspenseProps) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}
