import { Link } from '@timber/app/client';
import { allDocs } from 'content-collections';

export const metadata = {
  title: 'Documentation | timber.js',
  description: 'timber.js documentation — a Vite-native React framework for Cloudflare Workers.',
  robots: 'noindex, nofollow',
};

// Featured docs to highlight on the index page
const FEATURED_SLUGS = [
  'getting-started',
  'routing',
  'data-fetching',
  'forms-and-actions',
  'deployment',
  'why-timber',
];

export default function DocsIndexPage() {
  const featured = FEATURED_SLUGS.map((slug) =>
    allDocs.find((d) => d.version === 'v1' && d.slug === slug)
  ).filter((d): d is NonNullable<typeof d> => d != null);

  return (
    <div>
      <h1 className="text-3xl font-bold text-walnut dark:text-grain mb-2">timber.js Documentation</h1>
      <p className="text-sap dark:text-walnut-light mb-10">v1 &mdash; pre-release</p>

      <div className="grid gap-4">
        {featured.map((doc) => (
          <Link
            key={doc.slug}
            href={`/pre-release/docs/v1/${doc.slug}`}
            className="block p-5 rounded-lg border border-grain dark:border-walnut/30 hover:border-bark-light dark:hover:border-walnut-light hover:bg-grain-light/50 dark:hover:bg-walnut/20 transition-colors"
          >
            <h2 className="text-base font-semibold text-walnut dark:text-grain mb-1">{doc.title}</h2>
            <p className="text-sm text-bark-light dark:text-sap">{doc.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
