import type { ReactNode } from 'react';
import { Link } from '@timber-js/app/client';

export default function NestedInnerLayout({ children }: { children: ReactNode }) {
  return (
    <div data-testid="nested-inner-layout" className="space-y-4">
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
        <div className="text-xs font-medium text-stone-400 mb-2">Inner layout navigation</div>
        <nav className="flex gap-3 text-sm">
          <Link
            href="/nested-layouts/section"
            className="text-amber-700 hover:text-amber-900 hover:underline"
          >
            Section index
          </Link>
          <Link
            href="/nested-layouts/section/detail"
            className="text-amber-700 hover:text-amber-900 hover:underline"
          >
            Detail page
          </Link>
        </nav>
      </div>

      <div className="rounded-lg border border-dotted border-stone-300 p-3">
        <div className="text-xs font-medium text-stone-400 mb-2">Inner layout content area</div>
        {children}
      </div>
    </div>
  );
}
