import type { ReactNode } from 'react';

export default function ParallelDefaultLayout({
  children,
  widget,
}: {
  children: ReactNode;
  widget: ReactNode;
}) {
  return (
    <div data-testid="parallel-default-layout">
      <div data-testid="parallel-default-main">{children}</div>
      <div data-testid="parallel-default-widget-slot">{widget}</div>
    </div>
  );
}
