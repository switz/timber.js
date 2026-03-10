import { allBlogs } from 'content-collections';
import { deny } from '@timber/app/server';
import type { Metadata } from '@timber/app/server';

export async function generateStaticParams() {
  return allBlogs
    .filter((p) => !p.draft)
    .map((post) => ({ slug: post._meta.path }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const post = allBlogs.find((p) => p._meta.path === slug);
  if (!post) return {};
  return { title: post.title, description: post.description };
}

export default async function BlogPost(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = allBlogs.find((p) => p._meta.path === slug);
  if (!post) deny(404);

  return (
    <article data-testid="blog-post">
      <header data-testid="blog-post-header">
        <h1>{post.title}</h1>
        <p data-testid="blog-post-author">By {post.author}</p>
        <time dateTime={post.publishedAt.toISOString()}>
          {post.publishedAt.toLocaleDateString()}
        </time>
        {post.tags.length > 0 && (
          <div data-testid="blog-post-tags">
            {post.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        )}
      </header>
      <div className="prose" data-testid="blog-post-content">
        {/* MDX content would be rendered here via useMDXComponent */}
      </div>
    </article>
  );
}
