/**
 * TopLoader — Built-in progress bar for client navigations.
 *
 * Shows an animated progress bar at the top of the viewport while an RSC
 * navigation is in flight. Injected automatically by the framework into
 * TransitionRoot — users never render this component directly.
 *
 * Configuration is via timber.config.ts `topLoader` key. Enabled by default.
 * Users who want a fully custom progress indicator disable the built-in one
 * (`topLoader: { enabled: false }`) and use `useNavigationPending()` directly.
 *
 * Animation approach: pure CSS @keyframes. The bar crawls from 0% to ~90%
 * width over ~30s using ease-out timing. When navigation completes, the bar
 * snaps to 100% and fades out over 200ms. No JS animation loops (RAF, setInterval).
 *
 * The bar respects a configurable delay (default 150ms) — if navigation
 * resolves faster than the delay, the bar never appears.
 *
 * See design/19-client-navigation.md §"useNavigationPending()"
 * See LOCAL-336 for design decisions.
 */

'use client';

import { useState, useEffect, useRef, createElement } from 'react';
import { usePendingNavigationUrl } from './navigation-context.js';

// ─── Types ───────────────────────────────────────────────────────

export interface TopLoaderConfig {
  /** Whether the top-loader is enabled. Default: true. */
  enabled?: boolean;
  /** Bar color. Default: '#2299DD'. */
  color?: string;
  /** Bar height in pixels. Default: 3. */
  height?: number;
  /** Show subtle glow/shadow effect. Default: true. */
  shadow?: boolean;
  /** Delay in ms before showing the bar. Default: 150. */
  delay?: number;
  /** CSS z-index. Default: 1600. */
  zIndex?: number;
}

// ─── Defaults ────────────────────────────────────────────────────

const DEFAULT_COLOR = '#2299DD';
const DEFAULT_HEIGHT = 3;
const DEFAULT_SHADOW = true;
const DEFAULT_DELAY = 150;
const DEFAULT_Z_INDEX = 1600;

// ─── Keyframes ID ────────────────────────────────────────────────

// Unique keyframes name to avoid collisions with user styles.
const KEYFRAMES_NAME = '__timber_top_loader_crawl';

// Track whether the @keyframes rule has been injected into the document.
let keyframesInjected = false;

/**
 * Inject the @keyframes rule into the document head once.
 * Uses a <style> tag so the animation is available for inline-styled elements.
 */
function ensureKeyframes(): void {
  if (keyframesInjected) return;
  if (typeof document === 'undefined') return;

  const style = document.createElement('style');
  style.textContent = `
@keyframes ${KEYFRAMES_NAME} {
  0% { width: 0%; }
  100% { width: 90%; }
}
`;
  document.head.appendChild(style);
  keyframesInjected = true;
}

// ─── Component ───────────────────────────────────────────────────

/**
 * Internal top-loader component. Injected by TransitionRoot.
 *
 * Reads pending navigation state from PendingNavigationContext.
 * Shows nothing when no navigation is pending or when the navigation
 * resolves before the delay threshold.
 */
export function TopLoader({ config }: { config?: TopLoaderConfig }): React.ReactElement | null {
  const pendingUrl = usePendingNavigationUrl();
  const isPending = pendingUrl !== null;

  const color = config?.color ?? DEFAULT_COLOR;
  const height = config?.height ?? DEFAULT_HEIGHT;
  const shadow = config?.shadow ?? DEFAULT_SHADOW;
  const delay = config?.delay ?? DEFAULT_DELAY;
  const zIndex = config?.zIndex ?? DEFAULT_Z_INDEX;

  // Track visibility states:
  // - 'hidden': no bar shown
  // - 'crawling': bar is animating from 0% to 90%
  // - 'finishing': bar is snapping to 100% and fading out
  const [phase, setPhase] = useState<'hidden' | 'crawling' | 'finishing'>('hidden');
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inject keyframes on mount
  useEffect(() => {
    ensureKeyframes();
  }, []);

  // Handle pending state changes
  useEffect(() => {
    if (isPending) {
      // Navigation started — wait for delay before showing the bar
      // Clear any finish timer from a previous navigation
      if (finishTimerRef.current !== null) {
        clearTimeout(finishTimerRef.current);
        finishTimerRef.current = null;
      }

      if (delay > 0) {
        delayTimerRef.current = setTimeout(() => {
          delayTimerRef.current = null;
          setPhase('crawling');
        }, delay);
      } else {
        setPhase('crawling');
      }
    } else {
      // Navigation ended (or was never pending)
      // Clear the delay timer — if it hasn't fired, the bar never shows
      if (delayTimerRef.current !== null) {
        clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
        // Bar was never shown — stay hidden
        if (phase === 'hidden') return;
      }

      if (phase === 'crawling') {
        // Bar was visible — snap to 100% and fade out
        setPhase('finishing');
        finishTimerRef.current = setTimeout(() => {
          finishTimerRef.current = null;
          setPhase('hidden');
        }, 200);
      }
      // If already 'finishing' or 'hidden', do nothing
    }

    return () => {
      if (delayTimerRef.current !== null) {
        clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- phase is read but intentionally not a dependency
  }, [isPending, delay]);

  // Cleanup finish timer on unmount
  useEffect(() => {
    return () => {
      if (finishTimerRef.current !== null) {
        clearTimeout(finishTimerRef.current);
      }
    };
  }, []);

  if (phase === 'hidden') return null;

  // ─── Styles ──────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: `${height}px`,
    zIndex,
    pointerEvents: 'none',
  };

  const barStyle: React.CSSProperties = {
    height: '100%',
    backgroundColor: color,
    ...(phase === 'crawling'
      ? {
          // Crawling: animate from 0% to 90% over 30s
          animation: `${KEYFRAMES_NAME} 30s ease-out forwards`,
        }
      : {
          // Finishing: snap to 100% and fade out
          width: '100%',
          opacity: 0,
          transition: 'width 200ms ease, opacity 200ms ease',
        }),
    ...(shadow
      ? {
          boxShadow: `0 0 10px ${color}, 0 0 5px ${color}`,
        }
      : {}),
  };

  return createElement(
    'div',
    {
      style: containerStyle,
      'aria-hidden': 'true',
      'data-timber-top-loader': '',
    },
    createElement('div', { style: barStyle })
  );
}
