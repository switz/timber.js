import { allDocs } from 'content-collections';
import { MDXContent } from '@content-collections/mdx/react';
import { deny } from '@timber/app/server';
import type { Metadata } from '@timber/app/server';
import { useMDXComponents } from '../../../../../mdx-components';

export async function generateStaticParams() {
  return allDocs.filter((d) => d.version === 'v1').map((d) => ({ slug: d.slug }));
}

export async function metadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = allDocs.find((d) => d.version === 'v1' && d.slug === slug);
  if (!doc) return {};
  return {
    title: `${doc.title} | timber.js docs`,
    description: doc.description,
    robots: 'noindex, nofollow',
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = allDocs.find((d) => d.version === 'v1' && d.slug === slug);
  if (!doc) deny(404);

  const components = useMDXComponents();
  return <MDXContent code={doc.mdx} components={components} />;
}
