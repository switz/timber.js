// History Stack — stores RSC payloads by URL for instant back/forward navigation
// See design/19-client-navigation.md § History Stack

// ─── Types ───────────────────────────────────────────────────────

export interface HistoryEntry {
  /** The complete segment tree payload at the time of navigation */
  payload: unknown;
  /** The scroll position when the user navigated away from this page */
  scrollY: number;
}

// ─── History Stack ───────────────────────────────────────────────

/**
 * Session-lived history stack keyed by URL. Enables instant back/forward
 * navigation without a server roundtrip.
 *
 * On forward navigation, the current page's payload (with scroll position)
 * is pushed onto the stack. On popstate, the cached payload is replayed
 * and the saved scrollY is restored.
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
