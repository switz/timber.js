/**
 * Shim: next/headers → timber request context
 *
 * Re-exports timber's ALS-backed headers() and cookies() for libraries
 * that import from next/headers. These are real implementations backed
 * by AsyncLocalStorage, not stubs.
 *
 * See design/14-ecosystem.md §"next/headers" for the full shim audit.
 */

export { headers, cookies } from '#/server/request-context.js';
