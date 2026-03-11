import type { ReactNode } from 'react';

export default function ParallelLayout({
  children,
  admin,
}: {
  children: ReactNode;
  admin: ReactNode;
}) {
  return (
    <div data-testid="parallel-layout">
      <div data-testid="parallel-main">{children}</div>
      <div data-testid="parallel-admin-slot">{admin}</div>
    </div>
  );
}
