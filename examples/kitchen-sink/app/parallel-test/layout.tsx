import type { ReactNode } from 'react';

export default function DashboardLayout({
  children,
  stats,
  activity,
}: {
  children: ReactNode;
  stats: ReactNode;
  activity: ReactNode;
}) {
  return (
    <div data-testid="parallel-layout" className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Parallel Routes</h1>
        <p className="mt-1 text-sm text-stone-500">
          Multiple slots (
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">@stats</code>,{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">@activity</code>)
          render simultaneously alongside{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">children</code>. Each
          slot has independent error handling.
        </p>
      </div>
      <div data-testid="parallel-children">{children}</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div data-testid="parallel-stats-slot">{stats}</div>
        <div data-testid="parallel-activity-slot">{activity}</div>
      </div>
    </div>
  );
}
