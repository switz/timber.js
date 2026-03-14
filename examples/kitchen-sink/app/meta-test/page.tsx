import type { Metadata } from '@timber/app/server';
import { Link } from '@timber/app/client';

export const metadata: Metadata = {
  title: 'Meta Test Page',
  description: 'Testing metadata with title template',
};

export default function MetaTestPage() {
  return (
    <div data-testid="meta-test-page" className="max-w-2xl space-y-6">
      <div>
        <h1 data-testid="meta-test-heading" className="text-2xl font-bold text-stone-900">
          Metadata Test
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Title template from the root layout applies:{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">
            %s | Kitchen Sink
          </code>
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-1">Expected document.title</div>
        <div className="text-lg font-semibold text-stone-800">Meta Test Page | Kitchen Sink</div>
      </div>

      <div className="flex gap-2">
        <Link
          href="/meta-test/absolute"
          className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
        >
          Absolute title
        </Link>
        <Link
          href="/meta-test/abc"
          className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
        >
          Dynamic title
        </Link>
        <Link
          href="/"
          className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
