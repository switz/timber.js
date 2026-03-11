import type { ReactNode } from 'react';

export default function GroupALayout({ children }: { children: ReactNode }) {
  return <div data-testid="group-a-layout">{children}</div>;
}
