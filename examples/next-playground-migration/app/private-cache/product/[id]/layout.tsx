// MIGRATION: generateStaticParams is a Next.js SSG convention — timber
// builds dynamically so this export is removed. The route works without it.
// MIGRATION: loading.tsx is not a file convention in timber.
// Instead, wrap {children} in <Suspense fallback={<Loading />}> in the layout.
import { Suspense } from 'react';
import Loading from './loading';

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
