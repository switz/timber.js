/**
 * Per-request waitUntil bridge — ALS bridge for platform adapters.
 *
 * The generated entry point (Nitro, Cloudflare) wraps the handler with
 * `runWithWaitUntil`, binding the platform's lifecycle extension function
 * (e.g., h3's `event.waitUntil()` or CF's `ctx.waitUntil()`) for the
 * request duration. The `waitUntil()` primitive reads from this ALS to
 * dispatch background work to the correct platform API.
 *
 * Design doc: design/11-platform.md §"waitUntil()"
 */

import { waitUntilAls } from './als-registry.js';

/**
 * Run a function with a per-request waitUntil handler installed.
 *
 * Called by generated entry points (Nitro node-server/bun, Cloudflare)
 * to bind the platform's lifecycle extension for the request duration.
 */
export function runWithWaitUntil<T>(waitUntilFn: (promise: Promise<unknown>) => void, fn: () => T): T {
  return waitUntilAls.run(waitUntilFn, fn);
}

/**
 * Get the current request's waitUntil function, if available.
 *
 * Returns undefined when no platform adapter has installed a waitUntil
 * handler for the current request (e.g., on platforms that don't support
 * lifecycle extension, or outside a request context).
 */
export function getWaitUntil(): ((promise: Promise<unknown>) => void) | undefined {
  return waitUntilAls.getStore();
}
