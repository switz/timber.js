// History Stack — stores RSC payloads by URL for instant back/forward navigation
// See design/19-client-navigation.md § History Stack

import type { HeadElement } from './head';

// ─── Types ───────────────────────────────────────────────────────

export interface HistoryEntry {
  /** The complete segment tree payload at the time of navigation */
  payload: unknown;
  /** The scroll position when the user navigated away from this page */
  scrollY: number;
  /** Resolved head elements for this page (title, meta tags). Null for SSR'd initial page. */
  headElements?: HeadElement[] | null;
  /** Route params for this page (for useParams). Null for SSR'd initial page. */
  params?: Record<string, string | string[]> | null;
}

// ─── History Stack ───────────────────────────────────────────────

/**
 * Session-lived history stack keyed by URL. Enables instant back/forward
 * navigation without a server roundtrip.
 *
 * On forward navigation, the new page's payload is pushed onto the stack.
 * On popstate, the cached payload is replayed and the saved scrollY is
 * restored via afterPaint.
 *
 * Entries persist for the session duration (no expiry) and are cleared
 * when the tab is closed — matching browser back-button behavior.
 */
export class HistoryStack {
  private entries = new Map<string, HistoryEntry>();

  push(url: string, entry: HistoryEntry): void {
    this.entries.set(url, entry);
  }

  get(url: string): HistoryEntry | undefined {
    return this.entries.get(url);
  }

  /** Update the scroll position for an existing entry */
  updateScroll(url: string, scrollY: number): void {
    const entry = this.entries.get(url);
    if (entry) {
      entry.scrollY = scrollY;
    }
  }

  has(url: string): boolean {
    return this.entries.has(url);
  }
}
