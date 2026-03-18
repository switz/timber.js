'use client';

/**
 * Null fallback component for the slot catch-all error boundary.
 *
 * When a slot throws an error that isn't caught by a user-defined error.tsx,
 * this boundary renders nothing — the slot gracefully degrades per
 * design/02-rendering-pipeline.md §"Slot Access Failure = Graceful Degradation".
 *
 * This must be a 'use client' component because TimberErrorBoundary passes it
 * as a prop (fallbackComponent), and server component functions cannot be
 * passed directly to client components.
 */
export default function SlotErrorFallback(): null {
  return null;
}
