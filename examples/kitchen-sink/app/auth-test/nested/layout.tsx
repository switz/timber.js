import type { ReactNode } from 'react';

export default function NestedLayout({ children }: { children: ReactNode }) {
  return (
    <div data-testid="nested-layout">
      <h2 data-testid="nested-layout-heading">Nested Auth Layout</h2>
      {children}
    </div>
  );
}
