'use client';

import { bindUseQueryStates } from '@timber/app/client';
import searchParamsDef from './search-params';

// Bind hooks at module scope — safe because bindUseQueryStates returns a hook
// function, it doesn't call nuqs yet. Aliasing (pg, s) is preserved.
const useAllParams = bindUseQueryStates(searchParamsDef);
const useShallowSort = bindUseQueryStates(searchParamsDef.pick('sort'));

export default function FilterBar() {
  // Triggers RSC navigation on change (shallow: false default)
  const [{ page, q, sort }, setParams] = useAllParams();

  // Shallow-mode demo — client-only URL update, no RSC fetch
  const [{ sort: shallowSort }, setShallowParams] = useShallowSort();

  return (
    <div data-testid="filter-bar" className="space-y-4">
      {/* Current state badges */}
      <div className="flex flex-wrap gap-2">
        <span
          data-testid="client-page"
          className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-medium text-blue-700"
        >
          <span className="text-blue-400">page</span> {page}
        </span>
        <span
          data-testid="client-q"
          className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 border border-violet-200 px-3 py-1 text-xs font-medium text-violet-700"
        >
          <span className="text-violet-400">q</span> {q ?? <em className="text-violet-300">null</em>}
        </span>
        <span
          data-testid="client-sort"
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-medium text-emerald-700"
        >
          <span className="text-emerald-400">sort</span> {sort}
        </span>
      </div>

      {/* Deep controls (triggers RSC navigation) */}
      <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">
            Server roundtrip
          </span>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-500">
            shallow: false
          </span>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-stone-500 font-medium w-12">Sort</span>
            <select
              data-testid="sort-select"
              value={sort}
              onChange={(e) =>
                setParams({
                  sort: e.target.value as 'relevance' | 'price-asc' | 'price-desc' | 'newest',
                })
              }
              className="rounded-md border border-stone-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:outline-none"
            >
              <option value="relevance">Relevance</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="newest">Newest</option>
            </select>
          </label>
          <div className="flex items-center gap-1.5">
            <button
              data-testid="prev-page-btn"
              disabled={page <= 1}
              onClick={() => setParams({ page: page - 1 })}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              &larr; Prev
            </button>
            <button
              data-testid="next-page-btn"
              onClick={() => setParams({ page: page + 1 })}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-stone-800 transition-colors"
            >
              Next &rarr;
            </button>
          </div>
        </div>
      </div>

      {/* Shallow mode demo (no server roundtrip) */}
      <div data-testid="shallow-sort-demo" className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-400">
            Shallow mode
          </span>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-500">
            no server roundtrip
          </span>
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-stone-500 font-medium w-12">Search</span>
            <input
              data-testid="q-input"
              value={q ?? ''}
              onChange={(e) => setParams({ q: e.target.value || null }, { shallow: true })}
              placeholder="Type to search..."
              className="rounded-md border border-stone-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:outline-none w-48"
            />
          </label>
          <div className="flex items-center gap-3">
            <span data-testid="shallow-sort-value" className="text-sm font-mono text-stone-600">
              sort: {shallowSort}
            </span>
            <button
              data-testid="shallow-sort-btn"
              onClick={() => setShallowParams({ sort: 'newest' }, { shallow: true })}
              className="rounded-md border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-600 shadow-sm hover:bg-stone-50 transition-colors"
            >
              Set sort=newest (shallow)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
