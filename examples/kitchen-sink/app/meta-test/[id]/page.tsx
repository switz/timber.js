import type { Metadata } from '@timber/app/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Item ${id}`,
    description: `Dynamic metadata for item ${id}`,
  };
}

export default async function DynamicMetaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div data-testid="meta-dynamic-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="meta-dynamic-heading" className="text-2xl font-bold text-stone-900">
          Dynamic Metadata
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Uses <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">generateMetadata()</code> to
          produce a title from route params.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs font-medium text-stone-400">params.id</div>
          <div data-testid="meta-dynamic-id" className="mt-1 text-2xl font-semibold text-stone-800">
            {id}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs font-medium text-stone-400">Expected document.title</div>
          <div className="mt-1 text-lg font-semibold text-stone-800">Item {id} | Kitchen Sink</div>
        </div>
      </div>
    </div>
  );
}
