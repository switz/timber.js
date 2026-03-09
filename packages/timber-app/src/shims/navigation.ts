/**
 * Shim: next/navigation → timber navigation primitives
 *
 * Re-exports timber's navigation hooks for libraries like nuqs
 * that import from next/navigation. Only exports what timber implements.
 *
 * Note: nuqs imports next/navigation.js (with .js extension).
 * The timber-shims plugin strips .js before matching.
 */

export { useParams } from '../client/use-params.js';
export { redirect } from '../server/primitives.js';
