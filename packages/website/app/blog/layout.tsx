import type { ReactNode } from 'react';
import { SiteNav } from '../components/site-nav';
import { SiteFooter } from '../components/site-footer';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
