/**
 * Parallel routes layout — receives @sidebar and @modal as named props.
 *
 * Tests: parallel route rendering, slot updates on navigation,
 * default.tsx fallback, soft/hard navigation behavior.
 */
import { ParallelShell } from './parallel-shell';

export default function ParallelLayout({
  children,
  sidebar,
  modal,
}: {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <ParallelShell sidebar={sidebar} modal={modal}>
      {children}
    </ParallelShell>
  );
}
