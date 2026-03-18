import { deny } from '@timber-js/app/server';

// Calls deny(401) — falls back to root error.tsx since no 401.tsx or 4xx.tsx exists.
// Per design/10-error-handling.md, deny(401) outside Suspense produces HTTP 401.
export default function Deny401Page() {
  deny(401);
}
