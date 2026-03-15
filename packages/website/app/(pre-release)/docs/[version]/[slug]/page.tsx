import { allDocs } from 'content-collections';
import { deny } from '@timber/app/server';
import type { Metadata } from '@timber/app/server';
import { LATEST_VERSION } from '@/lib/docs';
import { AiDocsBanner } from '@/app/(pre-release)/components/ai-docs-banner';

export async function generateStaticParams() {
  return allDocs.map((d) => ({ version: d.version, slug: d.slug }));
}

export async function metadata({
  params,
}: {
  params: Promise<{ version: string; slug: string }>;
}): Promise<Metadata> {
  const { version, slug } = await params;
  const resolvedVersion = version === 'latest' ? LATEST_VERSION : version;
  const doc = allDocs.find((d) => d.version === resolvedVersion && d.slug === slug);
  if (!doc) return {};
  return {
    title: doc.title,
    description: doc.description,
  };
}

// Vite resolves import.meta.glob at build time — each .mdx file becomes a
// real ES module in the bundle, no `new Function()` / eval at runtime.
const mdxModules = import.meta.glob<{ default: React.ComponentType }>(
  '../../../../../content/docs/**/*.mdx'
);

export default async function DocPage({
  params,
}: {
  params: Promise<{ version: string; slug: string }>;
}) {
  const { version, slug } = await params;
  const resolvedVersion = version === 'latest' ? LATEST_VERSION : version;
  const doc = allDocs.find((d) => d.version === resolvedVersion && d.slug === slug);
  if (!doc) deny(404);

  const key = `../../../../../content/docs/${resolvedVersion}/${doc._meta.fileName}`;
  const loader = mdxModules[key];
  if (!loader) deny(404);

  const { default: MdxComponent } = await loader();

  return (
    <div className="docs-content">
      {!doc.notAI && <AiDocsBanner />}
      <MdxComponent />
    </div>
  );
}
