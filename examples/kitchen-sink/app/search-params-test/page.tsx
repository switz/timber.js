import { searchParams } from '@timber/app/server';
import { Link } from '@timber/app/client';
import FilterBar from './FilterBar';

export const metadata = { title: 'Search Params Test' };

export default async function SearchParamsTestPage() {
  const { page, q, sort } = await searchParams<'/search-params-test'>();

  return (
    <div data-testid="search-params-page" className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Search Params Test</h1>
        <p className="mt-1 text-sm text-stone-500">
          Typed searchParams parsing, URL key aliasing, and client state sync.
        </p>
      </div>

      <section data-testid="server-parsed-values" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
          Server-parsed values
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-xs font-medium text-stone-400">page</div>
            <div data-testid="server-page" className="mt-1 text-2xl font-semibold tabular-nums">
              {page}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-xs font-medium text-stone-400">q</div>
            <div data-testid="server-q" className="mt-1 text-2xl font-semibold truncate">
              {q === null ? (
                <span className="text-stone-300 text-base italic">null</span>
              ) : (
                String(q)
              )}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-xs font-medium text-stone-400">sort</div>
            <div data-testid="server-sort" className="mt-1 text-sm font-mono font-semibold">
              {sort}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-800">URL key aliasing</h2>
        <p className="mt-1 text-sm text-amber-700">
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono">?pg=</code> maps to{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono">page</code>,{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono">?s=</code> maps to{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono">sort</code>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
          Client filter (useQueryStates)
        </h2>
        <FilterBar />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
          Typed Link navigation
        </h2>
        <div className="flex gap-2">
          <Link
            href="/search-params-test"
            data-testid="typed-link-static"
            className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
          >
            Reset params
          </Link>
          <Link
            href="/routes-test/[id]"
            params={{ id: '42' }}
            data-testid="typed-link-dynamic"
            className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
          >
            Dynamic route /routes-test/42
          </Link>
        </div>
      </section>
    </div>
  );
}
