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
          <h2 className="text-base font-semibold text-stone-800 mb-1">Streaming</h2>
          <p className="text-xs text-stone-400 mb-3">
            Suspense boundaries, deferred rendering, and the hold window.
          </p>
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
          <h2 className="text-base font-semibold text-stone-800 mb-1">Error Handling</h2>
          <p className="text-xs text-stone-400 mb-3">
            Real HTTP status codes, status-code files, and typed error digests.
          </p>
          <ul className="space-y-1.5 text-sm">
            <li>
              <Link href="/errors/crash" className="text-amber-700 hover:text-amber-900 hover:underline">
                Unhandled error → error.tsx (500)
              </Link>
            </li>
            <li>
              <Link href="/errors/render-error" className="text-amber-700 hover:text-amber-900 hover:underline">
                RenderError with typed digest (500)
              </Link>
            </li>
            <li>
              <Link href="/errors/deny-403" className="text-amber-700 hover:text-amber-900 hover:underline">
                deny(403) → 403.tsx
              </Link>
            </li>
            <li>
              <Link href="/errors/deny-401" className="text-amber-700 hover:text-amber-900 hover:underline">
                deny(401) → error.tsx fallback
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-stone-800 mb-1">Middleware</h2>
          <p className="text-xs text-stone-400 mb-3">
            Per-route middleware that sets headers, injects context, and short-circuits.
          </p>
          <ul className="space-y-1.5 text-sm">
            <li>
              <Link href="/middleware-test/headers" className="text-amber-700 hover:text-amber-900 hover:underline">
                Response headers
              </Link>
            </li>
            <li>
              <Link href="/middleware-test/inject" className="text-amber-700 hover:text-amber-900 hover:underline">
                Request header injection
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-stone-800 mb-1">Auth &amp; Access Control</h2>
          <p className="text-xs text-stone-400 mb-3">
            Segment access.ts, slot denial with denied.tsx, and nested access chains.
          </p>
          <ul className="space-y-1.5 text-sm">
            <li>
              <Link href="/auth-test/parallel" className="text-amber-700 hover:text-amber-900 hover:underline">
                Parallel slot (denied.tsx)
              </Link>
            </li>
            <li>
              <Link href="/auth-test/parallel-default" className="text-amber-700 hover:text-amber-900 hover:underline">
                Slot default.tsx fallback
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-stone-800 mb-1">Search Params &amp; Typed Routes</h2>
          <p className="text-xs text-stone-400 mb-3">
            Typed searchParams, URL key aliasing, and typed Link/useParams.
          </p>
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
          <h2 className="text-base font-semibold text-stone-800 mb-1">Routing Patterns</h2>
          <p className="text-xs text-stone-400 mb-3">
            Intercepting routes, parallel slots, nested layouts, and MDX pages.
          </p>
          <ul className="space-y-1.5 text-sm">
            <li>
              <Link href="/gallery" className="text-amber-700 hover:text-amber-900 hover:underline">
                Intercepting routes (photo modal)
              </Link>
            </li>
            <li>
              <Link href="/parallel-test" className="text-amber-700 hover:text-amber-900 hover:underline">
                Parallel route slots (dashboard)
              </Link>
            </li>
            <li>
              <Link href="/nested-layouts" className="text-amber-700 hover:text-amber-900 hover:underline">
                Nested layouts
              </Link>
            </li>
            <li>
              <Link href="/mdx-test" className="text-amber-700 hover:text-amber-900 hover:underline">
                MDX page
              </Link>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-stone-800 mb-1">Metadata</h2>
          <p className="text-xs text-stone-400 mb-3">
            Title templates, absolute titles, and dynamic metadata.
          </p>
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
                Dynamic metadata
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
