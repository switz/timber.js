import { Link } from '@timber/app/client';
import { SiteNav } from './(pre-release)/components/site-nav';
import { SiteFooter } from './(pre-release)/components/site-footer';

const features = [
  {
    title: 'Correct HTTP',
    description: 'Real status codes, real headers. No more 200-for-everything.',
  },
  {
    title: 'No loading spinners',
    description: 'Primary content renders before the shell flushes. Pages arrive complete.',
  },
  {
    title: 'Vite-native',
    description: 'Built on Vite 7. ESM-first. Sub-second HMR.',
  },
  {
    title: 'Deploy anywhere',
    description:
      'Servers, serverless, edge, or static. Adapters for Node, Cloudflare, Vercel, and more.',
  },
  {
    title: 'Server actions',
    description: 'Forms that work without JavaScript. Progressive enhancement by default.',
  },
  {
    title: 'React Server Components',
    description: 'Server-rendered by default. Client JS only where you ask for it.',
  },
];

export default function HomePage() {
  return (
    <>
      <SiteNav />

      {/* Hero */}
      <section className="px-4 pt-24 pb-20 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-walnut dark:text-stone-100">
          timber.js
        </h1>
        <p className="mt-4 text-lg sm:text-xl text-bark dark:text-stone-400 max-w-2xl mx-auto">
          A Vite-native React framework for Cloudflare Workers.
          <br className="hidden sm:block" />
          Correct HTTP semantics. Pages that work without JavaScript.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/docs"
            className="inline-flex items-center px-6 py-3 rounded-lg bg-timber text-white font-medium hover:bg-timber-dark transition-colors"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/switz/timber.js"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center px-6 py-3 rounded-lg border border-grain dark:border-stone-600 text-bark dark:text-stone-300 font-medium hover:bg-grain-light dark:hover:bg-stone-800 transition-colors"
          >
            GitHub
          </a>
        </div>
      </section>

      {/* Feature grid */}
      <section className="px-4 pb-24 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-grain dark:border-stone-700 p-6"
            >
              <h3 className="text-base font-semibold text-walnut dark:text-stone-200">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm text-bark dark:text-stone-400 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

export const metadata = {
  title: 'timber.js — Vite-native React framework',
  description:
    'A web framework built on Vite and React Server Components for Cloudflare Workers. Correct HTTP semantics, real status codes, pages that work without JavaScript.',
};
