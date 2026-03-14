export default function ParallelDefaultPage() {
  return (
    <div data-testid="parallel-default-page" className="space-y-4">
      <div>
        <h1 data-testid="parallel-default-heading" className="text-2xl font-bold text-stone-900">
          Parallel Default Slot Test
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          The <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">@widget</code>{' '}
          slot&apos;s access.ts denies, but it has no denied.tsx — so it falls back to default.tsx.
        </p>
      </div>
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Main content</div>
        <p className="text-sm text-stone-800">Main page content — always visible</p>
      </div>
    </div>
  );
}
