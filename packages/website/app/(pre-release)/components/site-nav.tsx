import { Link } from '@timber/app/client';

export function SiteNav() {
  return (
    <header className="sticky top-0 z-10 bg-white dark:bg-stone-900 border-b border-grain dark:border-stone-700">
      <nav className="mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg text-timber dark:text-stone-100">
          timber.js
        </Link>
        <div className="flex items-center gap-6 text-sm">
          <Link
            href="/docs"
            className="text-bark dark:text-stone-400 hover:text-walnut dark:hover:text-stone-100 transition-colors"
          >
            Docs
          </Link>
          <Link
            href="/blog"
            className="text-bark dark:text-stone-400 hover:text-walnut dark:hover:text-stone-100 transition-colors"
          >
            Blog
          </Link>
          <a
            href="https://github.com/switz/timber.js"
            target="_blank"
            rel="noopener"
            className="text-bark dark:text-stone-400 hover:text-walnut dark:hover:text-stone-100 transition-colors"
          >
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}
