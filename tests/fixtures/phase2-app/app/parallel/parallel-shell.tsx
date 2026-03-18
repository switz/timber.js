'use client';

/**
 * Client component shell for the parallel routes layout.
 * Provides navigation links and test IDs for E2E assertions.
 */
import { Link } from '@timber-js/app/client';

export function ParallelShell({
  children,
  sidebar,
  modal,
}: {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div data-testid="parallel-layout">
      <nav data-testid="parallel-nav">
        <Link href="/parallel" data-testid="link-parallel-home">
          Home
        </Link>
        <Link href="/parallel/projects" data-testid="link-parallel-projects">
          Projects
        </Link>
        <Link href="/parallel/about" data-testid="link-parallel-about">
          About
        </Link>
      </nav>

      <div style={{ display: 'flex', gap: '16px' }}>
        <aside data-testid="sidebar-slot">{sidebar}</aside>
        <main data-testid="main-content">{children}</main>
      </div>

      <div data-testid="modal-slot">{modal}</div>
    </div>
  );
}
