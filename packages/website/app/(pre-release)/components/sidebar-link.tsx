'use client';

import { Link, usePathname } from '@timber-js/app/client';

export function SidebarLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`block text-sm py-1 px-2 rounded transition-colors ${
        isActive
          ? 'bg-grain dark:bg-stone-700 text-walnut dark:text-stone-100 font-medium'
          : 'text-bark dark:text-stone-400 hover:text-walnut dark:hover:text-stone-100 hover:bg-grain dark:hover:bg-stone-800'
      }`}
    >
      {children}
    </Link>
  );
}
