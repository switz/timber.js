import { searchParams } from '@timber/app/server';
import { Link } from '@timber/app/client';
import FilterBar from './FilterBar';

export const metadata = { title: 'Search Params Test' };

export default async function SearchParamsTestPage() {
  const { page, q, sort } = await searchParams<'/search-params-test'>();

  return (
    <div data-testid="search-params-page">
      <h1>Search Params Test</h1>
      <p>Demonstrates typed searchParams parsing, URL key aliasing, and client state sync.</p>

      <section data-testid="server-parsed-values">
        <h2>Server-parsed values</h2>
        <p>
          <span data-testid="server-page">page: {page}</span>
        </p>
        <p>
          <span data-testid="server-q">q: {q === null ? '(null)' : String(q)}</span>
        </p>
        <p>
          <span data-testid="server-sort">sort: {sort}</span>
        </p>
      </section>

      <section>
        <h2>URL key aliasing</h2>
        <p>
          Short URL keys: <code>?pg=</code> maps to <code>page</code>, <code>?s=</code> maps to{' '}
          <code>sort</code>
        </p>
      </section>

      <section>
        <h2>Client filter (useQueryStates)</h2>
        <FilterBar />
      </section>

      <section>
        <h2>Typed Link navigation</h2>
        <ul>
          <li>
            <Link href="/search-params-test" data-testid="typed-link-static">
              Reset (static typed Link)
            </Link>
          </li>
          <li>
            <Link href="/routes-test/[id]" params={{ id: '42' }} data-testid="typed-link-dynamic">
              Dynamic route /routes-test/42
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
