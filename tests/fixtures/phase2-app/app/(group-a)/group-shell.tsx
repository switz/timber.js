'use client';

import { useState } from 'react';
import { Link } from '@timber-js/app/client';

export function GroupShell({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  return (
    <section data-testid="group-a-layout">
      <div data-testid="group-a-state">{count}</div>
      <button type="button" data-testid="group-a-increment" onClick={() => setCount((n) => n + 1)}>
        Increment
      </button>
      <nav>
        <Link href="/page-a" data-testid="link-group-page-a">
          Page A
        </Link>
        <Link href="/page-b" data-testid="link-group-page-b">
          Page B
        </Link>
        <Link href="/page-c" data-testid="link-group-page-c">
          Page C
        </Link>
      </nav>
      <div>{children}</div>
    </section>
  );
}
