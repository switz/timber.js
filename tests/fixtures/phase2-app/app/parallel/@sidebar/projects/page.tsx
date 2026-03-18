/**
 * Sidebar projects content — matches /parallel/projects.
 *
 * Imports 'use client' components to verify they are correctly serialized
 * as client references during RSC rendering:
 *   - ProjectFilter: direct import from a 'use client' file
 *   - ProjectCounter: imported via barrel export (non-'use client' index.ts)
 *
 * This is an async server component (common pattern: data fetching before
 * rendering client components). Regression test for LOCAL-297.
 */
import { ProjectFilter } from './project-filter';
import { ProjectCounter } from './components';

export default async function SidebarProjects() {
  // Simulate async data fetch (common pattern that triggers the bug)
  await Promise.resolve();

  return (
    <div data-testid="sidebar-projects">
      <h3>Sidebar: Projects</h3>
      <p>Sidebar content for projects route.</p>
      <ProjectFilter />
      <ProjectCounter />
    </div>
  );
}
