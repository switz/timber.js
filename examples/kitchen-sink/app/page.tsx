import { Link } from '@timber/app/client';

export const metadata = {
  title: { absolute: 'Kitchen Sink — timber.js' },
};

export default function HomePage() {
  return (
    <div data-testid="home-page">
      <h1 className="text-3xl font-bold mb-2">Kitchen Sink</h1>
      <p className="text-gray-600 mb-8">
        Comprehensive timber.js feature showcase and E2E test target.
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold mb-3">Streaming</h2>
          <ul className="space-y-1 text-sm">
            <li>
              <Link href="/streaming/suspense" className="text-blue-600 hover:underline">
                Suspense boundary
              </Link>
            </li>
            <li>
              <Link href="/streaming/deferred" className="text-blue-600 hover:underline">
                Deferred Suspense
              </Link>
            </li>
            <li>
              <Link href="/streaming/deny-inside" className="text-blue-600 hover:underline">
                deny() inside Suspense
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold mb-3">Error Handling</h2>
          <ul className="space-y-1 text-sm">
            <li>
              <Link href="/errors/crash" className="text-blue-600 hover:underline">
                Unhandled error (error.tsx)
              </Link>
            </li>
            <li>
              <Link href="/errors/render-error" className="text-blue-600 hover:underline">
                RenderError with digest
              </Link>
            </li>
            <li>
              <Link href="/errors/deny-403" className="text-blue-600 hover:underline">
                deny(403)
              </Link>
            </li>
            <li>
              <Link href="/errors/deny-401" className="text-blue-600 hover:underline">
                deny(401)
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold mb-3">Search Params + Typed Routes</h2>
          <ul className="space-y-1 text-sm">
            <li>
              <Link
                href="/search-params-test"
                data-testid="home-link-search-params"
                className="text-blue-600 hover:underline"
              >
                Typed searchParams (server + client)
              </Link>
            </li>
            <li>
              <Link
                href="/routes-test/[id]"
                params={{ id: '42' }}
                data-testid="home-link-dynamic"
                className="text-blue-600 hover:underline"
              >
                Dynamic route /routes-test/42
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold mb-3">Metadata</h2>
          <ul className="space-y-1 text-sm">
            <li>
              <Link href="/meta-test" className="text-blue-600 hover:underline">
                Title template
              </Link>
            </li>
            <li>
              <Link href="/meta-test/absolute" className="text-blue-600 hover:underline">
                Absolute title
              </Link>
            </li>
            <li>
              <Link href="/meta-test/abc" className="text-blue-600 hover:underline">
                Dynamic generateMetadata
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
