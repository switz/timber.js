'use client';

// MIGRATION: useLinkStatus from next/link is not available in timber.
// Replaced with useNavigationPending() which is timber's global navigation
// pending hook. Behavioral difference: timber's hook tracks any navigation,
// not just the specific link being clicked.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Suspense } from 'react';
import { useNavigationPending } from '@timber/app/client';

export type Item = { text: string; slug?: string; segment?: string };

export function Tabs({ basePath, items }: { basePath: string; items: Item[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <Tab key={basePath + item.slug} item={item} basePath={basePath} />
      ))}
    </div>
  );
}

export function Tab({ basePath = '', item }: { basePath?: string; item: Item }) {
  const href = item.slug ? `${basePath}/${item.slug}` : basePath;

  return (
    <Link href={href} className="text-sm font-semibold">
      <Suspense fallback={<TabContent>{item.text}</TabContent>}>
        <DynamicTabContent href={href}>{item.text}</DynamicTabContent>
      </Suspense>
    </Link>
  );
}

function DynamicTabContent({ children, href }: { children: React.ReactNode; href: string }) {
  const pathname = usePathname();
  const isActive = pathname === href;
  // MIGRATION: useNavigationPending is global; not per-link like useLinkStatus
  const isPending = useNavigationPending();

  return (
    <TabContent isActive={isActive} isPending={isPending}>
      {children}
    </TabContent>
  );
}

function TabContent({
  children,
  isActive,
  isPending,
}: {
  children: React.ReactNode;
  isActive?: boolean;
  isPending?: boolean;
}) {
  return (
    <span
      className={clsx('flex rounded-md px-3 py-1 transition duration-75', {
        'bg-gray-700 text-gray-100 hover:bg-gray-500 hover:text-white': !isActive && !isPending,
        'bg-blue-600 text-white': isActive,
        'bg-gray-800 text-gray-500 delay-75': isPending,
      })}
    >
      {children}
    </span>
  );
}
