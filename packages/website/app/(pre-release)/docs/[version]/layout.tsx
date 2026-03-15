import type { ReactNode } from 'react';
import { Link } from '@timber/app/client';
import { allDocs } from 'content-collections';
import { LATEST_VERSION, groupBy } from '@/lib/docs';

const SECTION_ORDER = ['Getting Started', 'Core Docs', 'Guides', 'API Reference', 'Comparisons'];

const SECTION_LABELS: Record<string, string> = {
  'Core Docs': 'Core',
};

function buildNav(resolvedVersion: string, urlVersion: string) {
  const versionDocs = allDocs
    .filter((d) => d.version === resolvedVersion)
    .sort((a, b) => a.order - b.order);

  const grouped = groupBy(versionDocs, 'section');

  return SECTION_ORDER.filter((s) => grouped[s]).map((section) => ({
    label: SECTION_LABELS[section] ?? section,
    links: grouped[section].map((d) => ({
      href: `/docs/${urlVersion}/${d.slug}`,
      text: d.title,
    })),
  }));
}

export default async function VersionedDocsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;
  const resolvedVersion = version === 'latest' ? LATEST_VERSION : version;
  const navSections = buildNav(resolvedVersion, version);

  return (
    <div className="flex min-h-screen bg-grain-light/30 dark:bg-stone-800">
      <aside className="w-60 shrink-0 border-r border-grain dark:border-stone-700 bg-grain-light dark:bg-stone-900 overflow-y-auto sticky top-0 h-screen">
        <nav className="p-5 flex flex-col gap-6">
          <Link
            href="/"
            className="text-sm font-bold text-timber dark:text-stone-100 tracking-tight"
          >
            timber.js
          </Link>
          {navSections.map((section) => (
            <div key={section.label}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-sap dark:text-stone-400 mb-2">
                {section.label}
              </h3>
              <ul className="space-y-0.5">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="block text-sm py-1 px-2 rounded text-bark dark:text-stone-400 hover:text-walnut dark:hover:text-stone-100 hover:bg-grain dark:hover:bg-stone-800 transition-colors"
                    >
                      {link.text}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 max-w-3xl px-8 py-10 mx-auto docs-content">{children}</main>
    </div>
  );
}
