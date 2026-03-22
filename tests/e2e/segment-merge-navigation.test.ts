/**
 * E2E Tests — Segment Tree Merging
 *
 * Tests that client-side segment tree merging correctly handles partial
 * RSC payloads. When the server skips sync layouts the client already has,
 * the client merger reconstructs the full element tree by splicing the
 * partial payload into cached segment subtrees.
 *
 * Key invariants:
 * 1. Sync layout state preserved across sibling page navigation
 * 2. Root layout state preserved across all client navigations
 * 3. Page content always re-renders (never stale)
 * 4. router.refresh() bypasses merging (full re-render)
 * 5. Back/forward replays merged payloads correctly
 * 6. Route group layouts handled correctly
 *
 * Design docs: design/19-client-navigation.md §"Navigation Reconciliation"
 * See also: design/13-security.md §"State tree manipulation"
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

// ─── Sync Layout State Preservation ──────────────────────────────

test.describe('sync layout state preserved across navigation', () => {
  test('root layout input value survives navigation to different pages', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForHydration(page);

    const layoutInput = page.locator('[data-testid="layout-input"]');
    await layoutInput.fill('preserve-this');

    // Navigate to a completely different page
    await page.click('[data-testid="link-todos"]');
    await page.waitForURL('/todos');

    // Root layout input should survive — root layout was preserved
    await expect(layoutInput).toHaveValue('preserve-this');
  });

  test('dashboard layout present after sibling navigation', async ({ page }) => {
    // Navigate within the dashboard — the dashboard layout should remain
    // visible regardless of whether its state was preserved or remounted.
    await page.goto('/dashboard');
    await waitForHydration(page);

    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');
    await expect(page.locator('[data-testid="settings-content"]')).toBeVisible();

    // Dashboard layout is still present (whether preserved or re-rendered)
    await expect(page.locator('[data-testid="dashboard-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-counter"]')).toBeVisible();
  });

  test('root layout state survives even when inner layout re-renders', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await waitForHydration(page);

    // Set state in root layout (outer, can be skipped)
    await page.locator('[data-testid="layout-input"]').fill('root-state');

    // Navigate to settings (sibling) — dashboard re-renders, root preserved
    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');

    // Root state survives (outer layout preserved by merger)
    await expect(page.locator('[data-testid="layout-input"]')).toHaveValue('root-state');

    // Navigate back to dashboard index — root still preserved
    await page.click('[data-testid="link-dashboard-home"]');
    await page.waitForURL('/dashboard');

    await expect(page.locator('[data-testid="layout-input"]')).toHaveValue('root-state');
  });
});

// ─── Page Always Re-renders ──────────────────────────────────────

test.describe('page content always re-renders', () => {
  test('navigating to settings shows settings content, not cached dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForHydration(page);

    await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible();

    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');

    // Settings page visible, dashboard page gone
    await expect(page.locator('[data-testid="settings-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-content"]')).not.toBeVisible();
  });

  test('navigating back shows dashboard content, not cached settings', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForHydration(page);
    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');

    await page.click('[data-testid="link-dashboard-home"]');
    await page.waitForURL('/dashboard');

    await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-content"]')).not.toBeVisible();
  });
});

// ─── router.refresh() Bypasses Merging ───────────────────────────

test.describe('router.refresh() full re-render', () => {
  test('refresh fetches fresh content — page re-renders', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForHydration(page);

    // Verify dashboard is visible
    await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible();

    // router.refresh() triggers a full re-render — no state tree, no skipping.
    // The dashboard layout and page are re-rendered from fresh server data.
    await page.click('[data-testid="refresh-button"]');

    // Dashboard should still be visible after refresh (content is fresh)
    await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible({ timeout: 10_000 });
    // Root layout present
    await expect(page.locator('[data-testid="root-layout"]')).toBeVisible();
  });
});

// ─── Back/Forward Navigation ─────────────────────────────────────

test.describe('back/forward with merged payloads', () => {
  test('back button replays complete tree, not partial payload', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForHydration(page);

    // Navigate forward
    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');
    await expect(page.locator('[data-testid="settings-content"]')).toBeVisible();

    // Go back
    await page.goBack();
    await page.waitForURL('/dashboard');

    // Dashboard should render correctly — not a broken partial tree
    await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="root-layout"]')).toBeVisible();
  });

  test('forward after back renders correctly', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForHydration(page);

    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');

    await page.goBack();
    await page.waitForURL('/dashboard');

    await page.goForward();
    await page.waitForURL('/dashboard/settings');

    await expect(page.locator('[data-testid="settings-content"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-layout"]')).toBeVisible();
  });

  test('layout structure intact after back navigation', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForHydration(page);

    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');

    await page.goBack();
    await page.waitForURL('/dashboard');

    // Full layout structure should be intact (not a broken partial tree)
    await expect(page.locator('[data-testid="root-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible();
  });
});

// ─── Route Group Navigation ─────────────────────────────────────

test.describe('route group segment merging', () => {
  test('group layout renders correctly on entry from root', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.click('[data-testid="link-group-page-a"]');
    await page.waitForURL('/group-page-a');

    // Both group layout and page should render
    await expect(page.locator('[data-testid="group-a-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-page-a"]')).toBeVisible();
    // Root layout still present
    await expect(page.locator('[data-testid="root-layout"]')).toBeVisible();
  });

  test('group layout renders correctly navigating between sibling pages', async ({ page }) => {
    await page.goto('/group-page-a');
    await waitForHydration(page);

    // Group layout visible
    await expect(page.locator('[data-testid="group-a-layout"]')).toBeVisible();

    // Navigate to sibling
    await page.click('[data-testid="link-group-page-b"]');
    await page.waitForURL('/group-page-b');

    // Group layout still visible, new page content shown
    await expect(page.locator('[data-testid="group-a-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-page-b"]')).toBeVisible();
  });

  test('navigating from group page to non-group page renders correctly', async ({ page }) => {
    await page.goto('/group-page-a');
    await waitForHydration(page);

    await page.click('[data-testid="link-dashboard"]');
    await page.waitForURL('/dashboard');

    // Dashboard renders, group layout gone
    await expect(page.locator('[data-testid="dashboard-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-a-layout"]')).not.toBeVisible();
  });

  test('no errors navigating between group and non-group routes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/group-page-a');
    await waitForHydration(page);

    // Group → sibling
    await page.click('[data-testid="link-group-page-b"]');
    await page.waitForURL('/group-page-b');
    await expect(page.locator('[data-testid="group-page-b"]')).toBeVisible();

    // Group → dashboard (cross-section)
    await page.click('[data-testid="link-dashboard"]');
    await page.waitForURL('/dashboard');
    await expect(page.locator('[data-testid="dashboard-layout"]')).toBeVisible();

    // Dashboard → group
    await page.click('[data-testid="link-group-page-a"]');
    await page.waitForURL('/group-page-a');
    await expect(page.locator('[data-testid="group-a-layout"]')).toBeVisible();

    expect(errors).toHaveLength(0);
  });
});

// ─── Cross-section Navigation ────────────────────────────────────

test.describe('cross-section navigation', () => {
  test('root state preserved across multiple SPA navigations', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.locator('[data-testid="layout-input"]').fill('multi-hop');

    // SPA navigate: root → dashboard → settings → back to dashboard
    await page.click('[data-testid="link-dashboard"]');
    await page.waitForURL('/dashboard');
    await expect(page.locator('[data-testid="layout-input"]')).toHaveValue('multi-hop');

    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');
    await expect(page.locator('[data-testid="layout-input"]')).toHaveValue('multi-hop');

    await page.click('[data-testid="link-dashboard-home"]');
    await page.waitForURL('/dashboard');
    await expect(page.locator('[data-testid="layout-input"]')).toHaveValue('multi-hop');
  });

  test('no console errors during rapid navigation within dashboard', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/dashboard');
    await waitForHydration(page);

    // Rapid navigation within dashboard
    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');
    await page.click('[data-testid="link-dashboard-home"]');
    await page.waitForURL('/dashboard');
    await page.click('[data-testid="link-settings"]');
    await page.waitForURL('/dashboard/settings');

    expect(errors).toHaveLength(0);
  });
});
