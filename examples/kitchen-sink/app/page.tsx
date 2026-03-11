import { Link } from '@timber/app/client';

export const metadata = {
  title: { absolute: 'Kitchen Sink — timber.js' },
};

export default function HomePage() {
  return (
    <div data-testid="home-page">
      <h1>Kitchen Sink</h1>
      <p>Comprehensive timber.js feature showcase and E2E test target.</p>

      <section>
        <h2>Streaming</h2>
        <ul>
          <li>
            <Link href="/streaming/suspense">Suspense boundary</Link>
          </li>
          <li>
            <Link href="/streaming/deferred">DeferredSuspense</Link>
          </li>
          <li>
            <Link href="/streaming/deny-inside">deny() inside Suspense</Link>
          </li>
        </ul>
      </section>

      <section>
        <h2>Error Handling</h2>
        <ul>
          <li>
            <Link href="/errors/crash">Unhandled error (error.tsx)</Link>
          </li>
          <li>
            <Link href="/errors/render-error">RenderError with digest</Link>
          </li>
          <li>
            <Link href="/errors/deny-403">deny(403)</Link>
          </li>
          <li>
            <Link href="/errors/deny-401">deny(401)</Link>
          </li>
        </ul>
      </section>
      <section>
        <h2>Metadata</h2>
        <ul>
          <li>
            <Link href="/meta-test">Title template</Link>
          </li>
          <li>
            <Link href="/meta-test/absolute">Absolute title</Link>
          </li>
          <li>
            <Link href="/meta-test/abc">Dynamic generateMetadata</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
