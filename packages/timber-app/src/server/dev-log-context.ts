/**
 * Dev log context — ALS-based accessor for the per-request DevLogEmitter.
 *
 * Allows cache, access gate, and other modules to emit dev log events
 * without threading the emitter through every function call.
 *
 * In production, no emitter is stored — getDevLogEmitter() returns undefined
 * and all call sites are guarded by the check.
 *
 * Design doc: 17-logging.md §"Dev Logging", 21-dev-server.md §"Dev Logging"
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { DevLogEmitter } from './dev-log-events.js';

const devLogAls = new AsyncLocalStorage<DevLogEmitter>();

/**
 * Run a callback with a DevLogEmitter in scope.
 * Used by the pipeline to establish per-request dev log scope.
 */
export function runWithDevLog<T>(emitter: DevLogEmitter, fn: () => T): T {
  return devLogAls.run(emitter, fn);
}

/**
 * Get the current request's DevLogEmitter, or undefined if not in dev mode.
 * Cache, access gate, and other modules use this to emit events.
 */
export function getDevLogEmitter(): DevLogEmitter | undefined {
  return devLogAls.getStore();
}
