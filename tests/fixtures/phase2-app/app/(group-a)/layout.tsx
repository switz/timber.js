/**
 * Layout for route group (group-a).
 *
 * Wraps pages in this group with a client component (GroupAShell) that holds
 * state. E2E tests verify this state survives client-side navigation between
 * sibling pages within the group.
 *
 * Includes an async server component (AsyncGroupHeader) that calls headers()
 * to simulate real-world patterns like NavBar in relisten-web. This tests
 * that async server components in group layouts don't break reconciliation
 * during client navigation.
 */
import { headers } from '@timber-js/app/server';
import { GroupAShell } from './group-a-shell';

/** Async server component that reads request headers — mirrors real NavBar patterns. */
async function AsyncGroupHeader() {
  const h = headers();
  const userAgent = h.get('user-agent') ?? 'unknown';
  // Just render a truncated UA to prove the async component executed
  return (
    <div data-testid="group-a-header">
      Group A Header (UA: {userAgent.slice(0, 20)})
    </div>
  );
}

export default function GroupALayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="group-a-layout">
      <AsyncGroupHeader />
      <GroupAShell>{children}</GroupAShell>
    </div>
  );
}
