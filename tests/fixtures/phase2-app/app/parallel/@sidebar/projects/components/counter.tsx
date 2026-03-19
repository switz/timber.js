'use client';

/**
 * Client component with useState — imported via barrel export to test
 * that 'use client' references survive re-export through non-client modules.
 */
import { useState } from 'react';

export function ProjectCounter() {
  const [count, setCount] = useState(0);

  return (
    <div data-testid="project-counter">
      <span data-testid="project-counter-value">{count}</span>
      <button data-testid="project-counter-button" onClick={() => setCount((c) => c + 1)}>
        +1
      </button>
    </div>
  );
}
