import { test, expect, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

test.describe('route group navigation', () => {
  test('preserves shared layout client state within the same route group', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/page-a');
    await waitForHydration(page);
    await expect(page.locator('[data-testid="group-a-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-page-a"]')).toBeVisible();

    await page.click('[data-testid="group-a-increment"]');
    await expect(page.locator('[data-testid="group-a-state"]')).toHaveText('1');

    await page.click('[data-testid="link-group-page-b"]');
    await page.waitForURL('/page-b');
    await expect(page.locator('[data-testid="group-page-b"]')).toBeVisible();

    await expect(page.locator('[data-testid="group-a-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-a-state"]')).toHaveText('1');
    expect(pageErrors).toEqual([]);
  });

  test('remounts when navigating to a different route group', async ({ page }) => {
    await page.goto('/page-a');
    await waitForHydration(page);

    await page.click('[data-testid="group-a-increment"]');
    await expect(page.locator('[data-testid="group-a-state"]')).toHaveText('1');

    await page.click('[data-testid="link-group-page-c"]');
    await page.waitForURL('/page-c');

    await expect(page.locator('[data-testid="group-page-c"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-b-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-a-layout"]')).toHaveCount(0);
  });
});
