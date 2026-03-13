import IdParams from './IdParams';

export default async function DynamicIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div data-testid="dynamic-id-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="dynamic-id-heading" className="text-2xl font-bold text-stone-900">
          Dynamic Route
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          File: <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">routes-test/[id]/page.tsx</code>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs font-medium text-stone-400">params.id (server)</div>
          <div data-testid="dynamic-id-value" className="mt-1 text-2xl font-semibold tabular-nums text-stone-800">
            {id}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs font-medium text-stone-400">useParams (client)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-stone-800">
            <IdParams />
          </div>
        </div>
      </div>
    </div>
  );
}
