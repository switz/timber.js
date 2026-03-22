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
 * Phase transitions are derived synchronously during render (React's
 * getDerivedStateFromProps pattern) — no useEffect needed for state tracking.
 * The finishing → hidden cleanup uses onTransitionEnd from the CSS transition.
 *
 * When delay > 0, CSS animation-delay + a visibility keyframe ensure the bar
 * stays invisible during the delay period. If navigation finishes before the
 * delay, the bar was never visible so the finish transition is also invisible.
 *
 * See design/19-client-navigation.md §"useNavigationPending()"
 * See LOCAL-336 for design decisions.
 */

'use client';

import { useState, createElement } from 'react';
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
  /** Delay in ms before showing the bar. Default: 0. */
  delay?: number;
  /** CSS z-index. Default: 1600. */
  zIndex?: number;
}

// ─── Defaults ────────────────────────────────────────────────────

const DEFAULT_COLOR = '#2299DD';
const DEFAULT_HEIGHT = 3;
const DEFAULT_SHADOW = true;
const DEFAULT_DELAY = 0;
const DEFAULT_Z_INDEX = 1600;

// ─── Keyframes ───────────────────────────────────────────────────

// Unique keyframes name to avoid collisions with user styles.
const CRAWL_KEYFRAMES = '__timber_top_loader_crawl';
const APPEAR_KEYFRAMES = '__timber_top_loader_appear';

// Track whether the @keyframes rules have been injected into the document.
let keyframesInjected = false;

/**
 * Inject the @keyframes rules into the document head once.
 * Called during render (idempotent). Uses a <style> tag so the
 * animations are available for inline-styled elements.
 */
function ensureKeyframes(): void {
  if (keyframesInjected) return;
  if (typeof document === 'undefined') return;

  const style = document.createElement('style');
  style.textContent = `
@keyframes ${CRAWL_KEYFRAMES} {
  0% { width: 0%; }
  100% { width: 90%; }
}
@keyframes ${APPEAR_KEYFRAMES} {
  from { opacity: 0; }
  to { opacity: 1; }
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
 * Phase transitions are derived synchronously during render:
 *
 *   hidden → crawling:   when isPending becomes true
 *   crawling → finishing: when isPending becomes false
 *   finishing → hidden:   when CSS transition ends (onTransitionEnd)
 *   finishing → crawling: when isPending becomes true again
 *
 * No useEffect — all state changes are either derived during render
 * (getDerivedStateFromProps pattern) or triggered by DOM events.
 */
export function TopLoader({ config }: { config?: TopLoaderConfig }): React.ReactElement | null {
  const pendingUrl = usePendingNavigationUrl();
  const isPending = pendingUrl !== null;

  const color = config?.color ?? DEFAULT_COLOR;
  const height = config?.height ?? DEFAULT_HEIGHT;
  const shadow = config?.shadow ?? DEFAULT_SHADOW;
  const delay = config?.delay ?? DEFAULT_DELAY;
  const zIndex = config?.zIndex ?? DEFAULT_Z_INDEX;

  const [phase, setPhase] = useState<'hidden' | 'crawling' | 'finishing'>('hidden');

  // ─── Synchronous phase derivation (getDerivedStateFromProps) ──
  // React allows setState during render if the value changes — it
  // immediately re-renders with the updated state before committing.

  if (isPending && (phase === 'hidden' || phase === 'finishing')) {
    setPhase('crawling');
  }
  if (!isPending && phase === 'crawling') {
    setPhase('finishing');
  }

  // Inject keyframes on first visible render (idempotent)
  if (phase !== 'hidden') {
    ensureKeyframes();
  }

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
          // Crawl from 0% to 90% over 30s. When delay > 0, both the crawl
          // and a visibility animation are delayed — the bar stays at width 0%
          // and opacity 0 during the delay, then appears and starts crawling.
          // With delay 0, the appear animation is instant (0s duration, no delay).
          animation: [
            `${CRAWL_KEYFRAMES} 30s ease-out ${delay}ms forwards`,
            `${APPEAR_KEYFRAMES} 0s ${delay}ms both`,
          ].join(', '),
        }
      : {
          // Finishing: snap to 100% width (200ms), THEN fade out (200ms).
          // The opacity transition is delayed so the user sees the bar
          // reach 100% before it disappears. Without the delay, both
          // transitions run simultaneously and the bar fades before the
          // fill animation is visible.
          width: '100%',
          opacity: 0,
          transition: 'width 200ms ease, opacity 200ms ease 200ms',
        }),
    ...(shadow
      ? {
          boxShadow: `0 0 10px ${color}, 0 0 5px ${color}`,
        }
      : {}),
  };

  // Clean up the finishing phase when the CSS transition completes.
  // onTransitionEnd fires once per transitioned property — we act on
  // the first one (opacity) and ignore subsequent (width).
  const handleTransitionEnd = phase === 'finishing'
    ? (e: React.TransitionEvent) => {
        if (e.propertyName === 'opacity') {
          setPhase('hidden');
        }
      }
    : undefined;

  return createElement(
    'div',
    {
      style: containerStyle,
      'aria-hidden': 'true',
      'data-timber-top-loader': '',
    },
    createElement('div', { style: barStyle, onTransitionEnd: handleTransitionEnd })
  );
}
