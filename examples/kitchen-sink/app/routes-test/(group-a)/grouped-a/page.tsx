export default function GroupedAPage() {
  return (
    <div data-testid="grouped-a-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="grouped-a-heading" className="text-2xl font-bold text-stone-900">
          Route Group A
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          File:{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">
            (group-a)/grouped-a/page.tsx
          </code>{' '}
          — route groups organize files without adding URL segments.
        </p>
      </div>
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Group</div>
        <div data-testid="grouped-a-group" className="text-sm font-mono text-stone-800">
          group-a
        </div>
      </div>
    </div>
  );
}
