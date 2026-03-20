/**
 * Server-Timing header — dev-mode timing breakdowns for Chrome DevTools.
 *
 * Collects timing entries per request using ALS. Each pipeline phase
 * (proxy, middleware, render, SSR, access, fetch) records an entry.
 * Before response flush, entries are formatted into a Server-Timing header.
 *
 * Only active in dev mode — zero overhead in production.
 *
 * See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing
 * Task: LOCAL-290
 */

import { AsyncLocalStorage } from 'node:async_hooks';

// ─── Types ────────────────────────────────────────────────────────────────

export interface TimingEntry {
  /** Metric name (alphanumeric + hyphens, no spaces). */
  name: string;
  /** Duration in milliseconds. */
  dur: number;
  /** Human-readable description (shown in DevTools). */
  desc?: string;
}

interface TimingStore {
  entries: TimingEntry[];
}

// ─── ALS ──────────────────────────────────────────────────────────────────

const timingAls = new AsyncLocalStorage<TimingStore>();

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Run a callback with a per-request timing collector.
 * Must be called at the top of the request pipeline (wraps the full request).
 */
export function runWithTimingCollector<T>(fn: () => T): T {
  return timingAls.run({ entries: [] }, fn);
}

/**
 * Record a timing entry for the current request.
 * No-ops if called outside a timing collector (e.g. in production).
 */
export function recordTiming(entry: TimingEntry): void {
  const store = timingAls.getStore();
  if (!store) return;
  store.entries.push(entry);
}

/**
 * Run a function and automatically record its duration as a timing entry.
 * Returns the function's result. No-ops the recording if outside a collector.
 */
export async function withTiming<T>(
  name: string,
  desc: string | undefined,
  fn: () => T | Promise<T>
): Promise<T> {
  const store = timingAls.getStore();
  if (!store) return fn();

  const start = performance.now();
  try {
    return await fn();
  } finally {
    const dur = Math.round(performance.now() - start);
    store.entries.push({ name, dur, desc });
  }
}

/**
 * Get the Server-Timing header value for the current request.
 * Returns null if no entries exist or outside a collector.
 *
 * Format: `name;dur=123;desc="description", name2;dur=456`
 * See RFC 6797 / Server-Timing spec for format details.
 */
export function getServerTimingHeader(): string | null {
  const store = timingAls.getStore();
  if (!store || store.entries.length === 0) return null;

  // Deduplicate names — if a name appears multiple times, suffix with index
  const nameCounts = new Map<string, number>();
  const entries = store.entries.map((entry) => {
    const count = nameCounts.get(entry.name) ?? 0;
    nameCounts.set(entry.name, count + 1);
    const uniqueName = count > 0 ? `${entry.name}-${count}` : entry.name;
    return { ...entry, name: uniqueName };
  });

  const parts = entries.map((entry) => {
    let part = `${entry.name};dur=${entry.dur}`;
    if (entry.desc) {
      // Escape quotes in desc per Server-Timing spec
      const safeDesc = entry.desc.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      part += `;desc="${safeDesc}"`;
    }
    return part;
  });

  // Respect header size limits — browsers typically handle up to 8KB headers.
  // Truncate if the header exceeds 4KB to leave room for other headers.
  const MAX_HEADER_SIZE = 4096;
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    const candidate = result ? `${result}, ${parts[i]}` : parts[i]!;
    if (candidate.length > MAX_HEADER_SIZE) break;
    result = candidate;
  }

  return result || null;
}

/**
 * Sanitize a URL for use in Server-Timing desc.
 * Strips query params and truncates long paths to avoid information leakage.
 */
export function sanitizeUrlForTiming(url: string): string {
  try {
    const parsed = new URL(url);
    const origin = parsed.host;
    let path = parsed.pathname;
    // Truncate long paths
    if (path.length > 50) {
      path = path.slice(0, 47) + '...';
    }
    return `${origin}${path}`;
  } catch {
    // Not a valid URL — truncate raw string
    if (url.length > 60) {
      return url.slice(0, 57) + '...';
    }
    return url;
  }
}
