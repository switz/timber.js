import type { Metadata } from '@timber/app/server';
import { Link } from '@timber/app/client';

export const metadata: Metadata = {
  title: 'Meta Test Page',
  description: 'Testing metadata with title template',
};

export default function MetaTestPage() {
  return (
    <div data-testid="meta-test-page">
      <h1 data-testid="meta-test-heading">Metadata Test</h1>
      <p>This page tests that the title template is applied.</p>
      <nav>
        <Link href="/meta-test/absolute">Absolute title</Link>
        {' | '}
        <Link href="/meta-test/abc">Dynamic title</Link>
        {' | '}
        <Link href="/">Home</Link>
      </nav>
    </div>
  );
}
