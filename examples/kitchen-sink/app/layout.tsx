import type { ReactNode } from 'react';
import type { Metadata } from '@timber/app/server';
import { Link } from '@timber/app/client';

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
        <header data-testid="site-header">
          <nav>
            <Link href="/" data-testid="link-home">Home</Link>
            <Link href="/streaming/suspense" data-testid="link-streaming-suspense">Streaming: Suspense</Link>
            <Link href="/streaming/deferred" data-testid="link-streaming-deferred">Streaming: Deferred</Link>
            <Link href="/streaming/deny-inside" data-testid="link-streaming-deny">Streaming: Deny Inside</Link>
            <Link href="/errors/crash" data-testid="link-errors-crash">Error: Crash</Link>
            <Link href="/errors/render-error" data-testid="link-errors-render">Error: RenderError</Link>
            <Link href="/errors/deny-403" data-testid="link-errors-deny-403">Error: Deny 403</Link>
            <Link href="/errors/deny-401" data-testid="link-errors-deny-401">Error: Deny 401</Link>
          </nav>
        </header>
        <main data-testid="main-content">{children}</main>
      </body>
    </html>
  );
}
