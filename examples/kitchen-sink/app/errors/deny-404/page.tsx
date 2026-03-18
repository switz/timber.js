import { deny } from '@timber-js/app/server';

// Calls deny(404) — renders the segment-level 404.tsx.
// Per design/10-error-handling.md, deny() outside Suspense produces the correct HTTP status.
export default function Deny404Page() {
  deny(404);
}
