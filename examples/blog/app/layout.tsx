import type { ReactNode } from 'react';
import { Link } from '@timber/app/client';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header data-testid="site-header">
          <nav>
            <Link href="/">Home</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/changelog">Changelog</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
