/**
 * Smoke tests for the kitchen-sink example app.
 *
 * Verifies the dev server starts and the home page renders.
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

test('home page renders', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-testid="home-page"]')).toBeVisible();
});

test('site header with navigation is present', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="site-header"]')).toBeVisible();
});
