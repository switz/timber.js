'use client';

// MIGRATION: useLinkStatus from next/link is a per-link pending indicator.
// timber.js does not have useLinkStatus. The closest equivalent is
// useNavigationPending() which is a global navigation pending indicator.
//
// Behavioral difference: next/link's useLinkStatus only shows pending for
// the specific link being clicked. timber's useNavigationPending shows
// pending for any active navigation. For this demo, the visual effect is
// the same — a spinner appears while navigating.
//
// Gap filed: see bd issue for adding per-link pending state to timber's Link.
import { useNavigationPending } from '@timber-js/app/client';

export function LinkStatus() {
  const pending = useNavigationPending();
  return pending ? <div className="spinner ml-auto size-4 shrink-0 rounded-full" /> : null;
}
