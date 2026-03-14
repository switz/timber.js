import type { ReactNode } from 'react';

export default function ParallelLayout({
  children,
  admin,
}: {
  children: ReactNode;
  admin: ReactNode;
}) {
  return (
    <div data-testid="parallel-layout" className="max-w-2xl space-y-4">
      <div data-testid="parallel-main">{children}</div>
      <div
        data-testid="parallel-admin-slot"
        className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4"
      >
        <div className="text-xs font-medium text-stone-400 mb-2">@admin slot</div>
        {admin}
      </div>
    </div>
  );
}
