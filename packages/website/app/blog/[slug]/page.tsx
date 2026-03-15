import { allBlogs } from 'content-collections';
import { deny } from '@timber/app/server';
import type { Metadata } from '@timber/app/server';

export async function generateStaticParams() {
  return allBlogs.filter((p) => !p.draft).map((post) => ({ slug: post.slug }));
}

export async function metadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = allBlogs.find((p) => p.slug === slug);
  if (!post) return {};
  return { title: post.title, description: post.description };
}

const mdxModules = import.meta.glob<{ default: React.ComponentType }>(
  '../../../content/blog/*.mdx'
);

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = allBlogs.find((p) => p.slug === slug);
  if (!post) deny(404);

  const key = `../../../content/blog/${post._meta.fileName}`;
  const loader = mdxModules[key];
  if (!loader) deny(404);

  const { default: MdxComponent } = await loader();

  return (
    <article className="max-w-2xl mx-auto px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-walnut dark:text-stone-100 mb-2">{post.title}</h1>
        <p className="text-sm text-sap dark:text-stone-500">
          {post.publishedAt.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
          {' · '}
          {post.author}
        </p>
        {post.tags.length > 0 && (
          <div className="flex gap-2 mt-3">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full bg-grain dark:bg-stone-700 text-bark dark:text-stone-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>
      <div className="docs-content">
        <MdxComponent />
      </div>
    </article>
  );
}
