import { type ReactNode } from 'react';
import type { Metadata } from '@timber/app/server';
import { Link } from '@timber/app/client';
import Counter from './Counter';

export const metadata: Metadata = {
  title: {
    default: 'Kitchen Sink',
    template: '%s | Kitchen Sink',
  },
  description: 'Comprehensive timber.js feature showcase',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body>
        <header
          data-testid="site-header"
          style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}
        >
          <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
            <Link href="/" data-testid="link-home">
              Home
            </Link>
            <Link href="/streaming/suspense" data-testid="link-streaming-suspense">
              Streaming: Suspense
            </Link>
            <Link href="/streaming/deferred" data-testid="link-streaming-deferred">
              Streaming: Deferred
            </Link>
            <Link href="/streaming/deny-inside" data-testid="link-streaming-deny">
              Streaming: Deny Inside
            </Link>
            <Link href="/errors/crash" data-testid="link-errors-crash">
              Error: Crash
            </Link>
            <Link href="/errors/render-error" data-testid="link-errors-render">
              Error: RenderError
            </Link>
            <Link href="/errors/deny-403" data-testid="link-errors-deny-403">
              Error: Deny 403
            </Link>
            <Link href="/errors/deny-401" data-testid="link-errors-deny-401">
              Error: Deny 401
            </Link>
            <Link href="/errors/deny-404" data-testid="link-errors-deny-404">
              Error: Deny 404
            </Link>
            <Link href="/middleware-test/headers" data-testid="link-mw-headers">
              MW: Headers
            </Link>
            <Link href="/middleware-test/inject" data-testid="link-mw-inject">
              MW: Inject
            </Link>
            <Link href="/middleware-test/short-circuit" data-testid="link-mw-short-circuit">
              MW: Short-Circuit
            </Link>
            <Link href="/middleware-test/nav-target" data-testid="link-mw-nav-target">
              MW: Nav Target
            </Link>
            <Link href="/auth-test/denied" data-testid="link-auth-denied">
              Auth: Denied
            </Link>
            <Link href="/auth-test/redirect" data-testid="link-auth-redirect">
              Auth: Redirect
            </Link>
            <Link href="/auth-test/parallel" data-testid="link-auth-parallel">
              Auth: Parallel Slot
            </Link>
            <Link href="/routes-test/42" data-testid="link-routes-dynamic">
              Routes: Dynamic
            </Link>
            <Link href="/routes-test/catch/a/b" data-testid="link-routes-catch">
              Routes: Catch-All
            </Link>
            <Link href="/routes-test/optional" data-testid="link-routes-optional">
              Routes: Optional
            </Link>
            <Link href="/routes-test/grouped-a" data-testid="link-routes-group-a">
              Routes: Group A
            </Link>
            <Link href="/routes-test/grouped-b" data-testid="link-routes-group-b">
              Routes: Group B
            </Link>
            <Link href="/search-params-test" data-testid="link-search-params">
              Search Params
            </Link>
            <Link href="/meta-test" data-testid="link-meta-test">
              Meta: Title
            </Link>
            <Link href="/meta-test/absolute" data-testid="link-meta-absolute">
              Meta: Absolute
            </Link>
            <Link href="/meta-test/abc" data-testid="link-meta-dynamic">
              Meta: Dynamic
            </Link>
            <Counter />
          </nav>
        </header>
        <main data-testid="main-content">{children}</main>
      </body>
    </html>
  );
}
