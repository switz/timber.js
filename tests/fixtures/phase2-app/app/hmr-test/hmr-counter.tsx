'use client';

/**
 * Client component with local state for HMR testing.
 *
 * React Fast Refresh should preserve the counter state when this
 * file is edited (e.g., changing the label text).
 */
import { useState } from 'react';
import { SHARED_VALUE } from './shared-module';

export function HmrCounter() {
  const [count, setCount] = useState(0);

  return (
    <div data-testid="hmr-counter">
      <span data-testid="hmr-counter-value">{count}</span>
      <button data-testid="hmr-counter-button" onClick={() => setCount((c) => c + 1)}>
        increment
      </button>
      <span data-testid="hmr-counter-label">Counter</span>
      <span data-testid="hmr-client-shared">client-shared:{SHARED_VALUE}</span>
    </div>
  );
}
