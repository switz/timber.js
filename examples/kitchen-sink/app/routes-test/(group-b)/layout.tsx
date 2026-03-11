import type { ReactNode } from 'react';

export default function GroupBLayout({ children }: { children: ReactNode }) {
  return <div data-testid="group-b-layout">{children}</div>;
}
