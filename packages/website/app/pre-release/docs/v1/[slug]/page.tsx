import { allDocs } from 'content-collections';
import { deny } from '@timber/app/server';
import type { Metadata } from '@timber/app/server';

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

// Vite resolves import.meta.glob at build time — each .mdx file becomes a
// real ES module in the bundle, no `new Function()` / eval at runtime.
const mdxModules = import.meta.glob<{ default: React.ComponentType }>(
  '../../../../../content/docs/v1/*.mdx'
);

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = allDocs.find((d) => d.version === 'v1' && d.slug === slug);
  if (!doc) deny(404);

  const key = `../../../../../content/docs/v1/${doc._meta.fileName}`;
  const loader = mdxModules[key];
  if (!loader) deny(404);

  const { default: MdxComponent } = await loader();

  return (
    <div className="docs-content">
      <MdxComponent />
    </div>
  );
}
