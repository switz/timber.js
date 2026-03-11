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
    <div data-testid="filter-bar">
      <div data-testid="client-page">page: {page}</div>
      <div data-testid="client-q">q: {q ?? '(null)'}</div>
      <div data-testid="client-sort">sort: {sort}</div>

      <div>
        <label>
          Search:{' '}
          <input
            data-testid="q-input"
            value={q ?? ''}
            onChange={(e) => setParams({ q: e.target.value || null }, { shallow: true })}
          />
        </label>
      </div>

      <div>
        <label>
          Sort:{' '}
          <select
            data-testid="sort-select"
            value={sort}
            onChange={(e) =>
              setParams({
                sort: e.target.value as 'relevance' | 'price-asc' | 'price-desc' | 'newest',
              })
            }
          >
            <option value="relevance">Relevance</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>

      <div>
        <button data-testid="next-page-btn" onClick={() => setParams({ page: page + 1 })}>
          Next page
        </button>
      </div>

      <div data-testid="shallow-sort-demo">
        <p>Shallow mode (no server roundtrip):</p>
        <div data-testid="shallow-sort-value">shallow sort: {shallowSort}</div>
        <button
          data-testid="shallow-sort-btn"
          onClick={() => setShallowParams({ sort: 'newest' }, { shallow: true })}
        >
          Set sort=newest (shallow)
        </button>
      </div>
    </div>
  );
}
