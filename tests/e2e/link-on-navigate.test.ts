/**
 * E2E Tests — Link onNavigate prop
 *
 * Tests the onNavigate prop on <Link> which fires before client-side
 * navigation commits. Calling e.preventDefault() in the handler skips
 * the default navigation.
 *
 * Design doc: design/19-client-navigation.md
 * Task: TIM-167
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
  // Wait for React effects to run — layout-marker gets data-id in a useEffect
  await page.waitForSelector('[data-testid="layout-marker"][data-id]', { state: 'attached', timeout: 5_000 });
}

test.describe('Link onNavigate', () => {
  test('onNavigate fires and preventDefault stops navigation', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    // Click the link whose onNavigate calls preventDefault()
    await page.click('[data-testid="link-on-navigate-prevent"]');

    // onNavigate should have fired (indicator appears)
    await expect(page.locator('[data-testid="on-navigate-fired"]')).toBeVisible();

    // Navigation should NOT have happened — still on /
    expect(page.url()).toMatch(/\/$/);
    await expect(page.locator('[data-testid="on-navigate-content"]')).not.toBeVisible();
  });

  test('onNavigate fires and navigation proceeds when not prevented', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    // Click the link whose onNavigate does NOT call preventDefault()
    await page.click('[data-testid="link-on-navigate-allow"]');

    // onNavigate should have fired
    await expect(page.locator('[data-testid="on-navigate-fired"]')).toBeVisible();

    // Navigation SHOULD have happened
    await page.waitForURL('/on-navigate-test');
    await expect(page.locator('[data-testid="on-navigate-content"]')).toBeVisible();
  });
});
