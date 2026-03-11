import type { ReactNode } from 'react';
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
          </nav>
        </header>
        <Counter />
        <main data-testid="main-content">{children}</main>
      </body>
    </html>
  );
}
