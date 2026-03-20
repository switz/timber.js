/**
 * RSC Runtime Adapter — Re-exports from @vitejs/plugin-rsc/rsc.
 *
 * This module insulates the rest of the framework from direct imports of
 * @vitejs/plugin-rsc. The plugin is pre-1.0 and its API surface will change.
 * By routing all RSC-environment imports through this single file, a breaking
 * upstream change only requires updating one place instead of every file that
 * touches the RSC runtime.
 *
 * Keep this as thin pass-through re-exports — the value is the single choke
 * point, not abstraction.
 */

export {
  renderToReadableStream,
  loadServerAction,
  decodeReply,
  decodeAction,
} from '@vitejs/plugin-rsc/rsc';
