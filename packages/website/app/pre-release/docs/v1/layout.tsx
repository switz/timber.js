import type { ReactNode } from 'react';
import { Link } from '@timber/app/client';
import { allDocs } from 'content-collections';

// Section display order
const SECTION_ORDER = [
  'Getting Started',
  'Core Docs',
  'Guides',
  'API Reference',
  'Comparisons',
];

// Short labels for sidebar headers
const SECTION_LABELS: Record<string, string> = {
  'Core Docs': 'Core',
};

function buildNav() {
  const v1Docs = allDocs
    .filter((d) => d.version === 'v1')
    .sort((a, b) => a.order - b.order);

  const sections: { label: string; links: { href: string; text: string }[] }[] = [];
  const grouped = new Map<string, typeof v1Docs>();

  for (const doc of v1Docs) {
    const existing = grouped.get(doc.section) ?? [];
    existing.push(doc);
    grouped.set(doc.section, existing);
  }

  for (const section of SECTION_ORDER) {
    const docs = grouped.get(section);
    if (!docs) continue;
    sections.push({
      label: SECTION_LABELS[section] ?? section,
      links: docs.map((d) => ({
        href: `/pre-release/docs/v1/${d.slug}`,
        text: d.title,
      })),
    });
  }

  return sections;
}

export default function DocsLayout({ children }: { children: ReactNode }) {
  const navSections = buildNav();

  return (
    <div className="flex min-h-screen bg-grain-light/30 dark:bg-stone-800">
      <aside className="w-60 shrink-0 border-r border-grain dark:border-stone-700 bg-grain-light dark:bg-stone-900 overflow-y-auto sticky top-0 h-screen">
        <nav className="p-5 flex flex-col gap-6">
          <Link href="/" className="text-sm font-bold text-timber dark:text-stone-100 tracking-tight">
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
      <main className="flex-1 min-w-0 max-w-3xl px-8 py-10 mx-auto docs-content">
        {children}
      </main>
    </div>
  );
}
