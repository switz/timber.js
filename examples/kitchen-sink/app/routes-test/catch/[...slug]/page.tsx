export default async function CatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return (
    <div data-testid="catch-all-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="catch-all-heading" className="text-2xl font-bold text-stone-900">
          Catch-All Route
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          File:{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">
            catch/[...slug]/page.tsx
          </code>{' '}
          — matches any number of path segments.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">params.slug</div>
        <div data-testid="catch-all-value" className="text-sm font-mono text-stone-800">
          {slug.join('/')}
        </div>
        <div className="mt-2 text-xs text-stone-400">
          [
          {slug.map((s, i) => (
            <span key={i}>
              {i > 0 ? ', ' : ''}&quot;{s}&quot;
            </span>
          ))}
          ]
        </div>
      </div>
    </div>
  );
}
