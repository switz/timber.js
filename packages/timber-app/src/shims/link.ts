'use client';

/**
 * Shim: next/link → @timber-js/app/client Link
 *
 * Re-exports timber's Link component so libraries that import next/link
 * get the timber equivalent without modification.
 *
 * Imports from @timber-js/app/client (not #/) so the component resolves
 * to the same module instance as user code in Vite dev.
 */

export { Link as default, Link } from '@timber-js/app/client';
export type { LinkProps } from '@timber-js/app/client';
