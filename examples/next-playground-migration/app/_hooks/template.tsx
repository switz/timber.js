// MIGRATION: template.tsx is not a file convention in timber.js.
// In Next.js, template.tsx creates a new component instance on every navigation,
// unlike layouts which are cached and reused. timber.js does not have this
// distinction — all layouts work like Next.js templates (they're async and
// re-rendered on every navigation by default).
//
// This file is kept for documentation purposes. The wrapping Boundary has been
// moved into the layout.tsx to preserve visual appearance.
//
// Gap filed: see bd issue timber-XXX

import React from 'react';

// Not exported as a route convention — timber ignores template.tsx
export default function Template({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
