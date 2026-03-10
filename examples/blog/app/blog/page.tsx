import { allBlogs } from 'content-collections';
import { Link } from '@timber/app/client';

export const metadata = { title: 'Blog' };

export default function BlogIndex() {
  const posts = allBlogs
    .filter((p) => !p.draft)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return (
    <div data-testid="blog-index">
      <h1>Blog</h1>
      <ul data-testid="blog-list">
        {posts.map((post) => (
          <li key={post._meta.path} data-testid="blog-item">
            <Link href={`/blog/${post._meta.path}`}>
              <h2>{post.title}</h2>
              <p>{post.description}</p>
              <time dateTime={post.publishedAt.toISOString()}>
                {post.publishedAt.toLocaleDateString()}
              </time>
            </Link>
            {post.tags.length > 0 && (
              <div data-testid="blog-tags">
                {post.tags.map((t) => (
                  <span key={t} data-testid="blog-tag">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
