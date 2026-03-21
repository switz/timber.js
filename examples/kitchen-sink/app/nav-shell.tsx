'use client';

/**
 * Client shell for the kitchen-sink nav — provides:
 * - Global navigation pending indicator (useNavigationPending)
 * - Per-link pending status demo (useLinkStatus via LinkWithStatus)
 */
import { Link, useLinkStatus, useNavigationPending } from '@timber-js/app/client';

function LinkPendingIndicator() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="ml-1 text-yellow-400 animate-pulse">⏳</span>;
}

export function LinkWithStatus({
  href,
  testid,
  text,
}: {
  href: string;
  testid: string;
  text: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testid}
      className="flex items-center text-sm py-1 px-2 rounded text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
    >
      {text}
      <LinkPendingIndicator />
    </Link>
  );
}

export function GlobalPendingIndicator() {
  const pending = useNavigationPending();
  return (
    <div
      data-testid="global-pending"
      className={`fixed top-2 right-2 px-3 py-1 rounded-full text-xs font-medium transition-opacity ${
        pending ? 'bg-yellow-500 text-black opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      Loading…
    </div>
  );
}
