import type { Metadata } from '@timber/app/server';

export const metadata: Metadata = {
  title: 'Meta Test Page',
  description: 'Testing metadata with title template',
};

export default function MetaTestPage() {
  return (
    <div data-testid="meta-test-page">
      <h1 data-testid="meta-test-heading">Metadata Test</h1>
      <p>This page tests that the title template is applied.</p>
    </div>
  );
}
