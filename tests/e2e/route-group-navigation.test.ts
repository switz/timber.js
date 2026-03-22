/**
 * E2E Tests — Client Navigation with Route Groups
 *
 * Tests that client-side navigation between pages in the same route group
 * preserves layout state (React reconciles shared layouts instead of
 * remounting the entire tree).
 *
 * Regression test for LOCAL-333: navigating between sibling pages under
 * a shared route group layout caused the layout tree to be dropped and
 * client component context (e.g., QueryClientProvider) to be lost.
 *
 * Design docs: design/19-client-navigation.md, design/07-routing.md
 */

import { test, expect, type Page } from '@playwright/test';

/**
 * Wait for timber's client runtime to initialize (hydration + router setup).
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

test.describe('route group layout preservation', () => {
  test('client component state in group layout survives navigation between sibling pages', async ({
    page,
  }) => {
    // Navigate to a page in (group-a)
    await page.goto('/group-page-a');
    await waitForHydration(page);

    // Verify we're on the right page with the group layout
    await expect(page.locator('[data-testid="group-a-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-page-a"]')).toBeVisible();

    // Increment the counter in the group layout's client component
    await page.click('[data-testid="group-a-increment"]');
    await page.click('[data-testid="group-a-increment"]');
    await page.click('[data-testid="group-a-increment"]');

    // Verify counter is at 3
    await expect(page.locator('[data-testid="group-a-counter"]')).toHaveAttribute(
      'data-count',
      '3'
    );

    // Navigate to sibling page in the same route group
    await page.click('[data-testid="link-group-page-b"]');
    await page.waitForURL('/group-page-b');

    // New page should be visible
    await expect(page.locator('[data-testid="group-page-b"]')).toBeVisible();

    // Group layout should still be present
    await expect(page.locator('[data-testid="group-a-layout"]')).toBeVisible();

    // Counter state should be preserved (React reconciled, not remounted)
    await expect(page.locator('[data-testid="group-a-counter"]')).toHaveAttribute(
      'data-count',
      '3'
    );
  });

  test('root layout state survives navigation between pages in the same group', async ({
    page,
  }) => {
    await page.goto('/group-page-a');
    await waitForHydration(page);

    // Type into the root layout input (from root-shell.tsx)
    const layoutInput = page.locator('[data-testid="layout-input"]');
    await layoutInput.fill('preserve-me');

    // Navigate to sibling page
    await page.click('[data-testid="link-group-page-b"]');
    await page.waitForURL('/group-page-b');

    // Root layout input value should survive
    await expect(layoutInput).toHaveValue('preserve-me');
  });

  test('group layout is visible after navigating from root to group page', async ({ page }) => {
    // Start on the root page (outside any group)
    await page.goto('/');
    await waitForHydration(page);

    // Navigate to a page inside a route group
    await page.click('[data-testid="link-group-page-a"]');
    await page.waitForURL('/group-page-a');

    // Both the group layout and page should be visible
    await expect(page.locator('[data-testid="group-a-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-page-a"]')).toBeVisible();
  });

  test('root layout state survives navigation from outside to inside a route group', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHydration(page);

    // Set state in root layout
    const layoutInput = page.locator('[data-testid="layout-input"]');
    await layoutInput.fill('root-state');

    // Navigate into a route group
    await page.click('[data-testid="link-group-page-a"]');
    await page.waitForURL('/group-page-a');

    // Root layout state should survive
    await expect(layoutInput).toHaveValue('root-state');
  });

  test('no errors in console during route group navigation', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto('/group-page-a');
    await waitForHydration(page);

    // Navigate to sibling
    await page.click('[data-testid="link-group-page-b"]');
    await page.waitForURL('/group-page-b');
    await expect(page.locator('[data-testid="group-page-b"]')).toBeVisible();

    // Navigate back
    await page.click('[data-testid="link-group-page-a"]');
    await page.waitForURL('/group-page-a');
    await expect(page.locator('[data-testid="group-page-a"]')).toBeVisible();

    // No errors should have occurred
    expect(errors).toHaveLength(0);
  });
});
