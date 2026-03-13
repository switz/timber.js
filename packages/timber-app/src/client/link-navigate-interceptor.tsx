'use client';

// LinkNavigateInterceptor — client component that stores an onNavigate callback
// on the parent <a> element so the delegated click handler in browser-entry.ts
// can invoke it before triggering SPA navigation.
//
// See design/19-client-navigation.md, TIM-167

import { useRef, useEffect, type ReactNode } from 'react';

/** Symbol used to store the onNavigate callback on anchor elements. */
export const ON_NAVIGATE_KEY = '__timberOnNavigate' as const;

export type OnNavigateEvent = {
  preventDefault: () => void;
};

export type OnNavigateHandler = (e: OnNavigateEvent) => void;

/**
 * Augment HTMLAnchorElement with the optional onNavigate property.
 * Used by browser-entry.ts handleLinkClick to check for the callback.
 */
declare global {
  interface HTMLAnchorElement {
    [ON_NAVIGATE_KEY]?: OnNavigateHandler;
  }
}

/**
 * Client component rendered inside <Link> that attaches the onNavigate
 * callback to the closest <a> ancestor via a DOM property. The callback
 * is cleaned up on unmount.
 *
 * Renders no extra DOM — just a transparent wrapper.
 */
export function LinkNavigateInterceptor({
  onNavigate,
  children,
}: {
  onNavigate: OnNavigateHandler;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const anchor = ref.current?.closest('a');
    if (!anchor) return;
    anchor[ON_NAVIGATE_KEY] = onNavigate;
    return () => {
      delete anchor[ON_NAVIGATE_KEY];
    };
  }, [onNavigate]);

  // Use a <span> with display:contents to avoid affecting layout.
  // The ref lets us walk up to the parent <a> in the effect.
  return (
    <span ref={ref} style={{ display: 'contents' }}>
      {children}
    </span>
  );
}
