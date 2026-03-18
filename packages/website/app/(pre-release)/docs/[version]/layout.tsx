import type { ReactNode } from 'react';
import { Link } from '@timber-js/app/client';
import { allDocs } from 'content-collections';
import { LATEST_VERSION, groupBy } from '@/lib/docs';
import { SidebarLink } from '@/app/(pre-release)/components/sidebar-link';

const SECTION_ORDER = [
  'Getting Started',
  'Concepts',
  'Core Docs',
  'Guides',
  'API Reference',
  'Comparisons',
];

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
    <div className="flex min-h-[calc(100vh-3.5rem)] bg-grain-light/30 dark:bg-stone-900">
      <aside className="w-72 shrink-0 border-r border-grain dark:border-stone-700 bg-grain-light dark:bg-stone-900">
        <nav className="sticky top-14 p-5 flex flex-col gap-6 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
          <Link
            href="/docs"
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
                    <SidebarLink href={link.href}>{link.text}</SidebarLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="max-w-3xl px-8 py-10 mx-auto docs-content">{children}</div>
      </main>
    </div>
  );
}
