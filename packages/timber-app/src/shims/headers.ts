/**
 * Shim: next/headers → timber server
 *
 * Imports from @timber-js/app/server which Vite resolves to dist/server/index.js
 * via native package.json exports. This ensures the same ALS singleton as the
 * pipeline (both import from the same shared request-context chunk in dist/).
 */

export { headers, cookies } from '@timber-js/app/server';
