export default async function OptionalCatchAllPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;

  return (
    <div data-testid="optional-catch-all-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="optional-catch-all-heading" className="text-2xl font-bold text-stone-900">
          Optional Catch-All Route
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          File:{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">
            optional/[[...slug]]/page.tsx
          </code>{' '}
          — matches the base path and any sub-paths.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">params.slug</div>
        <div data-testid="optional-catch-all-value" className="text-sm font-mono text-stone-800">
          {slug ? JSON.stringify(slug) : '(no segments)'}
        </div>
      </div>
    </div>
  );
}
