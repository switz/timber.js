'use client';

/**
 * Link component that displays per-link pending status via useLinkStatus.
 * Used by E2E tests to verify the pending state flows through
 * PendingNavigationContext → LinkStatusProvider → useLinkStatus.
 */
import { Link, useLinkStatus } from '@timber-js/app/client';
import type { ReactNode } from 'react';

function StatusIndicator({ testId }: { testId: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      data-testid={`${testId}-status`}
      data-pending={pending ? 'true' : 'false'}
    >
      {pending ? '⏳' : ''}
    </span>
  );
}

export function LinkWithStatus({
  href,
  testId,
  children,
}: {
  href: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} data-testid={testId}>
      {children}
      <StatusIndicator testId={testId} />
    </Link>
  );
}
