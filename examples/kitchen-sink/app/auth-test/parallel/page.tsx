export default function ParallelPage() {
  return (
    <div data-testid="parallel-page" className="space-y-4">
      <div>
        <h1 data-testid="parallel-heading" className="text-2xl font-bold text-stone-900">
          Parallel Slot Auth Test
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          This page has an <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">@admin</code> parallel slot
          whose access.ts calls deny(). The slot renders denied.tsx while this main content stays visible.
        </p>
      </div>
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Main content</div>
        <p className="text-sm text-stone-800">This is the main page content — always visible.</p>
      </div>
    </div>
  );
}
