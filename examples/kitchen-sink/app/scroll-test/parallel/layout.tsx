import type { ReactNode } from 'react';

export default function ParallelScrollLayout({
  children,
  panel,
}: {
  children: ReactNode;
  panel: ReactNode;
}) {
  return (
    <div data-testid="parallel-scroll-layout">
      <div data-testid="parallel-scroll-main">{children}</div>
      <div
        data-testid="parallel-scroll-panel"
        style={{ borderTop: '2px solid #333', marginTop: '16px', paddingTop: '16px' }}
      >
        {panel}
      </div>
    </div>
  );
}
