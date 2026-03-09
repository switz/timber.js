/**
 * Root layout for Phase 2 E2E fixture app.
 *
 * Provides:
 * - Navigation links with test IDs for E2E assertions
 * - A persistent input to verify DOM state preservation across navigations
 * - A layout marker for revalidation tests
 * - Navigation pending indicator
 *
 * This is a server component. Interactive elements (input, pending indicator)
 * are in the RootShell client component.
 */
import { RootShell } from './root-shell';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Phase 2 E2E Fixture</title>
      </head>
      <body>
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
