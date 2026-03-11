import { deny } from '@timber/app/server';

// Calls deny(403) — renders the segment-level 403.tsx.
// Per design/10-error-handling.md, deny() outside Suspense produces the correct HTTP status.
export default function Deny403Page() {
  deny(403);
}
