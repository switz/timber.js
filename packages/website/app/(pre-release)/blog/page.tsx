import { Link } from '@timber/app/client';
import { allBlogs } from 'content-collections';

export const metadata = {
  title: 'Blog',
  description: 'Updates and announcements from the timber.js team.',
};

export default function BlogIndex() {
  const posts = allBlogs
    .filter((p) => !p.draft)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-walnut dark:text-stone-100 mb-8">Blog</h1>
      {posts.length === 0 ? (
        <p className="text-sap dark:text-stone-400">No posts yet.</p>
      ) : (
        <div className="space-y-8">
          {posts.map((post) => (
            <article key={post.slug}>
              <Link
                href={`/blog/${post.slug}`}
                className="block group"
              >
                <h2 className="text-xl font-semibold text-walnut dark:text-stone-100 group-hover:text-bark-light dark:group-hover:text-stone-300 transition-colors">
                  {post.title}
                </h2>
                <p className="text-sm text-sap dark:text-stone-500 mt-1">
                  {post.publishedAt.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                  {' · '}
                  {post.author}
                </p>
                <p className="text-bark-light dark:text-stone-400 mt-2">{post.description}</p>
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
