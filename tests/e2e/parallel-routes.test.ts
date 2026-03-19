/**
 * E2E Tests — Parallel Route Navigation
 *
 * Tests client-side navigation with parallel routes (@slot directories).
 * Covers slot updates, default.tsx fallback, soft/hard navigation,
 * history preservation, and independent loading states.
 *
 * Fixture: tests/fixtures/phase2-app/app/parallel/
 *   @sidebar/ — sidebar slot with page.tsx, projects/page.tsx, default.tsx
 *   @modal/   — modal slot with default.tsx only
 *
 * Design docs: design/02-rendering-pipeline.md §"Parallel Slots",
 *              design/19-client-navigation.md
 */

import { test, expect } from '@playwright/test';

// ─── Slot Rendering on Initial Load ──────────────────────────────────────────

test.describe('parallel route initial load', () => {
  test('renders layout with sidebar and modal slots', async ({ page }) => {
    await page.goto('/parallel');

    // Layout should be present
    await expect(page.locator('[data-testid="parallel-layout"]')).toBeVisible();

    // Sidebar slot should show its home page (matches /parallel)
    await expect(page.locator('[data-testid="sidebar-home"]')).toBeVisible();

    // Main content should show the home page
    await expect(page.locator('[data-testid="parallel-home-content"]')).toBeVisible();

    // Modal slot should show its default (empty div — attached but not visually visible)
    await expect(page.locator('[data-testid="modal-default"]')).toBeAttached();
  });

  test('renders matching sidebar page on /parallel/projects', async ({ page }) => {
    await page.goto('/parallel/projects');

    // Sidebar should show projects-specific content
    await expect(page.locator('[data-testid="sidebar-projects"]')).toBeVisible();

    // Main content should show the projects page
    await expect(page.locator('[data-testid="parallel-projects-content"]')).toBeVisible();
  });

  test('renders use client components with hooks in slot page (LOCAL-297)', async ({ page }) => {
    // Regression test: 'use client' components imported by slot pages must be
    // serialized as client references during RSC rendering, not executed on the
    // server. If executed server-side, hooks like useState throw "Invalid hook call".
    //
    // Tests both direct import and barrel export patterns with an async server
    // component page (the pattern that triggered the original bug).
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    const response = await page.goto('/parallel/projects');
    expect(response?.status()).toBe(200);

    // Direct import: ProjectFilter (use client with useState)
    await expect(page.locator('[data-testid="project-filter"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-filter-input"]')).toBeVisible();

    // Barrel export: ProjectCounter (use client via re-export)
    await expect(page.locator('[data-testid="project-counter"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-counter-value"]')).toHaveText('0');

    // No hook errors or hydration mismatches
    const hydrationErrors = errors.filter(
      (e) =>
        e.includes('hook') ||
        e.includes('Hydration') ||
        e.includes('hydrat') ||
        e.includes('mismatch')
    );
    expect(hydrationErrors).toEqual([]);

    // Verify direct-import component is interactive (hydrated)
    const input = page.locator('[data-testid="project-filter-input"]');
    await input.click();
    await input.pressSequentially('test', { delay: 50 });
    await expect(page.locator('[data-testid="project-filter-active"]')).toHaveText(
      'Filtering: test'
    );

    // Verify barrel-exported component is interactive (hydrated)
    await page.click('[data-testid="project-counter-button"]');
    await expect(page.locator('[data-testid="project-counter-value"]')).toHaveText('1');
  });

  test('renders default.tsx in sidebar on /parallel/about (no matching slot page)', async ({
    page,
  }) => {
    await page.goto('/parallel/about');

    // Sidebar has no page for /about — should render default.tsx
    await expect(page.locator('[data-testid="sidebar-default"]')).toBeVisible();

    // Main content should show the about page
    await expect(page.locator('[data-testid="parallel-about-content"]')).toBeVisible();
  });
});

// ─── Client Navigation Updates Slots ─────────────────────────────────────────

test.describe('updates slot on navigation', () => {
  test('sidebar updates when navigating from /parallel to /parallel/projects', async ({ page }) => {
    await page.goto('/parallel');
    await expect(page.locator('[data-testid="sidebar-home"]')).toBeVisible();

    // Navigate to projects
    await page.click('[data-testid="link-parallel-projects"]');
    await page.waitForURL('/parallel/projects');

    // Sidebar should now show projects content
    await expect(page.locator('[data-testid="sidebar-projects"]')).toBeVisible();
    // Old sidebar home should be gone
    await expect(page.locator('[data-testid="sidebar-home"]')).not.toBeVisible();

    // Main content should show projects
    await expect(page.locator('[data-testid="parallel-projects-content"]')).toBeVisible();
  });

  test('sidebar updates when navigating from /parallel/projects back to /parallel', async ({
    page,
  }) => {
    await page.goto('/parallel/projects');
    await expect(page.locator('[data-testid="sidebar-projects"]')).toBeVisible();

    // Navigate to home
    await page.click('[data-testid="link-parallel-home"]');
    await page.waitForURL('/parallel');

    // Sidebar should now show home content
    await expect(page.locator('[data-testid="sidebar-home"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar-projects"]')).not.toBeVisible();
  });
});

// ─── Hard Navigation Renders default.tsx ─────────────────────────────────────

test.describe('hard nav renders default', () => {
  test('full page load of /parallel/about renders sidebar default.tsx', async ({ page }) => {
    // Hard navigation (full page load) — sidebar has no /about page
    await page.goto('/parallel/about');

    await expect(page.locator('[data-testid="sidebar-default"]')).toBeVisible();
    await expect(page.locator('[data-testid="parallel-about-content"]')).toBeVisible();
  });

  test('client navigation to unmatched slot route renders default.tsx', async ({ page }) => {
    await page.goto('/parallel');
    await expect(page.locator('[data-testid="sidebar-home"]')).toBeVisible();

    // Navigate to /about — sidebar has no matching page
    await page.click('[data-testid="link-parallel-about"]');
    await page.waitForURL('/parallel/about');

    // On hard-style navigation (Link click to unmatched route), default.tsx renders
    await expect(page.locator('[data-testid="sidebar-default"]')).toBeVisible();
    await expect(page.locator('[data-testid="parallel-about-content"]')).toBeVisible();
  });
});

// ─── History Preserves Slots ─────────────────────────────────────────────────

test.describe('history preserves slots', () => {
  test('back button restores previous slot content', async ({ page }) => {
    await page.goto('/parallel');
    await expect(page.locator('[data-testid="sidebar-home"]')).toBeVisible();

    // Navigate to projects
    await page.click('[data-testid="link-parallel-projects"]');
    await page.waitForURL('/parallel/projects');
    await expect(page.locator('[data-testid="sidebar-projects"]')).toBeVisible();

    // Go back — should restore sidebar home content
    await page.goBack();
    await page.waitForURL('/parallel');
    await expect(page.locator('[data-testid="sidebar-home"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar-projects"]')).not.toBeVisible();
  });

  test('forward button restores slot content after back', async ({ page }) => {
    await page.goto('/parallel');
    await page.click('[data-testid="link-parallel-projects"]');
    await page.waitForURL('/parallel/projects');

    await page.goBack();
    await page.waitForURL('/parallel');

    // Go forward — should restore projects sidebar
    await page.goForward();
    await page.waitForURL('/parallel/projects');
    await expect(page.locator('[data-testid="sidebar-projects"]')).toBeVisible();
  });
});
