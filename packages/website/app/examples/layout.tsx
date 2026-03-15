import type { ReactNode } from 'react';
import { SiteNav } from '../components/site-nav';
import { SiteFooter } from '../components/site-footer';

export default function ExamplesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="max-w-xl mx-auto px-4 py-12">
        <p className="text-xs uppercase tracking-wider text-sap dark:text-stone-500 mb-6">
          Live Example
        </p>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
