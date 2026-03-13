import { Link } from '@timber/app/client';
import TallContent from '../TallContent';

export default function PageA() {
  return (
    <div data-testid="scroll-page-a" className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Scroll Test — Page A</h1>
        <p className="mt-1 text-sm text-stone-500">
          Client navigation scrolls to top by default.{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs font-mono">scroll=&#123;false&#125;</code> preserves position.
        </p>
      </div>
      <div className="flex gap-2">
        <Link
          href="/scroll-test/page-b"
          data-testid="link-to-page-b"
          className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
        >
          Go to Page B
        </Link>
        <Link
          href="/scroll-test/page-b"
          scroll={false}
          data-testid="link-to-page-b-no-scroll"
          className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
        >
          Page B (no scroll)
        </Link>
      </div>
      <TallContent id="page-a" />
    </div>
  );
}
