import { Link } from '@timber/app/client';

export const metadata = {
  title: { absolute: 'Kitchen Sink — timber.js' },
};

export default function HomePage() {
  return (
    <div data-testid="home-page">
      <h1 className="text-3xl font-bold text-stone-900 mb-2">Kitchen Sink</h1>
      <p className="text-stone-500 mb-8">
        Comprehensive timber.js feature showcase and E2E test target.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-stone-800 mb-3">Streaming</h2>
          <ul className="space-y-1.5 text-sm">
            <li>
              <Link href="/streaming/suspense" className="text-amber-700 hover:text-amber-900 hover:underline">
                Suspense boundary
              </Link>
            </li>
            <li>
              <Link href="/streaming/deferred" className="text-amber-700 hover:text-amber-900 hover:underline">
                Deferred Suspense
              </Link>
            </li>
            <li>
              <Link href="/streaming/deny-inside" className="text-amber-700 hover:text-amber-900 hover:underline">
                deny() inside Suspense
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-stone-800 mb-3">Error Handling</h2>
          <ul className="space-y-1.5 text-sm">
            <li>
              <Link href="/errors/crash" className="text-amber-700 hover:text-amber-900 hover:underline">
                Unhandled error (error.tsx)
              </Link>
            </li>
            <li>
              <Link href="/errors/render-error" className="text-amber-700 hover:text-amber-900 hover:underline">
                RenderError with digest
              </Link>
            </li>
            <li>
              <Link href="/errors/deny-403" className="text-amber-700 hover:text-amber-900 hover:underline">
                deny(403)
              </Link>
            </li>
            <li>
              <Link href="/errors/deny-401" className="text-amber-700 hover:text-amber-900 hover:underline">
                deny(401)
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-stone-800 mb-3">Search Params + Typed Routes</h2>
          <ul className="space-y-1.5 text-sm">
            <li>
              <Link
                href="/search-params-test"
                data-testid="home-link-search-params"
                className="text-amber-700 hover:text-amber-900 hover:underline"
              >
                Typed searchParams (server + client)
              </Link>
            </li>
            <li>
              <Link
                href="/routes-test/[id]"
                params={{ id: '42' }}
                data-testid="home-link-dynamic"
                className="text-amber-700 hover:text-amber-900 hover:underline"
              >
                Dynamic route /routes-test/42
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-stone-800 mb-3">Metadata</h2>
          <ul className="space-y-1.5 text-sm">
            <li>
              <Link href="/meta-test" className="text-amber-700 hover:text-amber-900 hover:underline">
                Title template
              </Link>
            </li>
            <li>
              <Link href="/meta-test/absolute" className="text-amber-700 hover:text-amber-900 hover:underline">
                Absolute title
              </Link>
            </li>
            <li>
              <Link href="/meta-test/abc" className="text-amber-700 hover:text-amber-900 hover:underline">
                Dynamic generateMetadata
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
