'use cache';

// MIGRATION: loading.tsx is not a file convention in timber.
// Instead, wrap {children} in <Suspense fallback={<Loading />}> in the layout.
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import db from '#/lib/db';
import Loading from './loading';
import { Boundary } from '#/ui/boundary';
import { Tabs } from '#/ui/tabs';

export default async function Layout({
  params,
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ section: string }>;
}) {
  const { section: sectionSlug } = await params;
  const section = db.section.find({ where: { slug: sectionSlug } });
  if (!section) {
    notFound();
  }

  const demo = db.demo.find({ where: { slug: 'loading' } });
  const categories = db.category.findMany({ where: { section: section?.id } });

  return (
    <Boundary label="[section]/layout.tsx" className="flex flex-col gap-9">
      <Tabs
        basePath={`/${demo.slug}/${section.slug}`}
        items={[
          { text: 'All' },
          ...categories.map((x) => ({ text: x.name, slug: x.slug })),
        ]}
      />

      <div><Suspense fallback={<Loading />}>{children}</Suspense></div>
    </Boundary>
  );
}
