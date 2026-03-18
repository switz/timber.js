import { Link } from '@timber-js/app/client';
import TallContent from '../TallContent';

export default function PageB() {
  return (
    <div data-testid="scroll-page-b" className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Scroll Test — Page B</h1>
        <p className="mt-1 text-sm text-stone-500">
          Navigating here from Page A should scroll to top.
        </p>
      </div>
      <Link
        href="/scroll-test/page-a"
        data-testid="link-to-page-a"
        className="inline-flex items-center rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
      >
        Go to Page A
      </Link>
      <TallContent id="page-b" />
    </div>
  );
}
