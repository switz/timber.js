import type { ReactNode } from 'react';
import { Link } from '@timber-js/app/client';

export default function NestedOuterLayout({ children }: { children: ReactNode }) {
  return (
    <div data-testid="nested-outer-layout" className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Nested Layouts</h1>
        <p className="mt-1 text-sm text-stone-500">
          Layouts wrap their children and persist across sibling navigations. This outer layout
          stays mounted when navigating between child pages.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-xs font-medium text-stone-400 mb-2">Outer layout navigation</div>
        <nav className="flex gap-3 text-sm" data-testid="nested-nav">
          <Link
            href="/nested-layouts"
            className="text-amber-700 hover:text-amber-900 hover:underline"
          >
            Index
          </Link>
          <Link
            href="/nested-layouts/section"
            className="text-amber-700 hover:text-amber-900 hover:underline"
          >
            Section (inner layout)
          </Link>
        </nav>
      </div>

      <div className="rounded-lg border border-dashed border-stone-300 p-4">
        <div className="text-xs font-medium text-stone-400 mb-2">Outer layout content area</div>
        {children}
      </div>
    </div>
  );
}
