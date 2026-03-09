/**
 * Shim: next/link → @timber/app/client Link
 *
 * Re-exports timber's Link component so libraries that import next/link
 * get the timber equivalent without modification.
 */

export { Link as default, Link } from '../client/link.js';
export type { LinkProps } from '../client/link.js';
