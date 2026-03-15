import type { ReactNode } from 'react';
import { SiteNav } from './components/site-nav';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main>{children}</main>
    </>
  );
}
