'use client';

/**
 * Client component shell for route group (group-a).
 *
 * Holds a counter in state. E2E tests increment the counter, navigate
 * to a sibling page, and check that the counter value survives — proving
 * React reconciled the layout instead of remounting it.
 */
import { useState } from 'react';

export function GroupAShell({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  return (
    <div>
      <div data-testid="group-a-counter" data-count={count}>
        Count: {count}
      </div>
      <button
        data-testid="group-a-increment"
        onClick={() => setCount((c) => c + 1)}
        type="button"
      >
        Increment
      </button>
      {children}
    </div>
  );
}
