'use cache';

// MIGRATION: loading.tsx is not a file convention in timber.
// Instead, wrap {children} in <Suspense fallback={<Loading />}> in the layout.
import { Suspense } from 'react';
import db from '#/lib/db';
import { Boundary } from '#/ui/boundary';
import { Mdx } from '#/ui/codehike';
import { Tabs } from '#/ui/tabs';
import type { Metadata } from '@timber/app/server';
import Readme from './readme.mdx';
import Loading from './loading';

export async function generateMetadata(): Promise<Metadata> {
  const demo = db.demo.find({ where: { slug: 'loading' } });

  return {
    title: demo.name,
    openGraph: { title: demo.name, images: [`/api/og?title=${demo.name}`] },
  };
}

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const demo = db.demo.find({ where: { slug: 'loading' } });
  const sections = db.section.findMany();

  return (
    <>
      <Boundary label="Demo" kind="solid" animateRerendering={false}>
        <Mdx source={Readme} collapsed={true} />
      </Boundary>

      <Boundary
        label="layout.tsx"
        kind="solid"
        animateRerendering={false}
        className="flex flex-col gap-9"
      >
        <Tabs
          basePath={`/${demo.slug}`}
          items={[
            { text: 'Home' },
            ...sections.map((x) => ({ text: x.name, slug: x.slug })),
          ]}
        />

        <Suspense fallback={<Loading />}>{children}</Suspense>
      </Boundary>
    </>
  );
}
