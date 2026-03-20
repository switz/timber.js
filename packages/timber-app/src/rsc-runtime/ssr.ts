/**
 * SSR Runtime Adapter — Re-exports from @vitejs/plugin-rsc/ssr.
 *
 * This module insulates the rest of the framework from direct imports of
 * @vitejs/plugin-rsc. The plugin is pre-1.0 and its API surface will change.
 * By routing all SSR-environment imports through this single file, a breaking
 * upstream change only requires updating one place.
 *
 * Keep this as thin pass-through re-exports — the value is the single choke
 * point, not abstraction.
 */

export { createFromReadableStream } from '@vitejs/plugin-rsc/ssr';
