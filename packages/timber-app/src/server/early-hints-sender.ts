/**
 * Per-request 103 Early Hints sender — ALS bridge for platform adapters.
 *
 * The pipeline collects Link headers for CSS, fonts, and JS chunks at
 * route-match time. On platforms that support it (Node.js v18.11+, Bun),
 * the adapter can send these as a 103 Early Hints interim response before
 * the final response is ready.
 *
 * This module provides an ALS-based bridge: the generated entry point
 * (e.g., the Nitro entry) wraps the handler with `runWithEarlyHintsSender`,
 * binding a per-request sender function. The pipeline calls
 * `sendEarlyHints103()` to fire the 103 if a sender is available.
 *
 * On platforms where 103 is handled at the CDN level (e.g., Cloudflare
 * converts Link headers into 103 automatically), no sender is installed
 * and `sendEarlyHints103()` is a no-op.
 *
 * Design doc: 02-rendering-pipeline.md §"Early Hints (103)"
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Function that sends Link header values as a 103 Early Hints response. */
export type EarlyHintsSenderFn = (links: string[]) => void;

const earlyHintsSenderAls = new AsyncLocalStorage<EarlyHintsSenderFn>();

/**
 * Run a function with a per-request early hints sender installed.
 *
 * Called by generated entry points (e.g., Nitro node-server/bun) to
 * bind the platform's writeEarlyHints capability for the request duration.
 */
export function runWithEarlyHintsSender<T>(sender: EarlyHintsSenderFn, fn: () => T): T {
  return earlyHintsSenderAls.run(sender, fn);
}

/**
 * Send collected Link headers as a 103 Early Hints response.
 *
 * No-op if no sender is installed for the current request (e.g., on
 * Cloudflare where the CDN handles 103 automatically, or in dev mode).
 *
 * Non-fatal: errors from the sender are caught and silently ignored.
 */
export function sendEarlyHints103(links: string[]): void {
  if (!links.length) return;
  const sender = earlyHintsSenderAls.getStore();
  if (!sender) return;
  try {
    sender(links);
  } catch {
    // Sending 103 is best-effort — failure never blocks the request.
  }
}
