export default function GroupedBPage() {
  return (
    <div data-testid="grouped-b-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="grouped-b-heading" className="text-2xl font-bold text-stone-900">
          Route Group B
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          File: <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">(group-b)/grouped-b/page.tsx</code> — a
          different layout group from Group A, sharing the same URL prefix.
        </p>
      </div>
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Group</div>
        <div data-testid="grouped-b-group" className="text-sm font-mono text-stone-800">group-b</div>
      </div>
    </div>
  );
}
