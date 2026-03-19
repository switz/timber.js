'use client';

/**
 * Client component with hooks — used to test that 'use client' components
 * imported by slot pages are correctly serialized as client references
 * during RSC rendering (not executed on the server).
 *
 * Regression test for LOCAL-297: RSC renderer was executing 'use client'
 * components instead of creating client references.
 */
import { useState } from 'react';

export function ProjectFilter() {
  const [filter, setFilter] = useState('');

  return (
    <div data-testid="project-filter">
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter projects..."
        data-testid="project-filter-input"
      />
      {filter && (
        <span data-testid="project-filter-active">Filtering: {filter}</span>
      )}
    </div>
  );
}
