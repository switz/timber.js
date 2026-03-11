/**
 * Smoke tests for the Phase 2 E2E fixture app.
 *
 * Verifies the dev server starts and serves routes correctly.
 * These tests run before the navigation/forms suites to catch
 * basic infrastructure issues early.
 */
import { test, expect } from '@playwright/test';

test('fixture app serves the home page', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-testid="home-content"]')).toBeVisible();
});

test('fixture app serves the dashboard page', async ({ page }) => {
  const response = await page.goto('/dashboard');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible();
});

test('fixture app serves the dashboard settings page', async ({ page }) => {
  const response = await page.goto('/dashboard/settings');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-testid="settings-content"]')).toBeVisible();
});

test('fixture app serves the todos page', async ({ page }) => {
  const response = await page.goto('/todos');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-testid="todos-content"]')).toBeVisible();
});

test('fixture app serves the slow page', async ({ page }) => {
  const response = await page.goto('/slow-page');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-testid="slow-page-content"]')).toBeVisible();
});

test('root layout is present on all pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="root-layout"]')).toBeVisible();
  await expect(page.locator('[data-testid="layout-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="layout-button"]')).toBeVisible();
});

test('dashboard layout is present on dashboard pages', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('[data-testid="dashboard-layout"]')).toBeVisible();
});

test('no hydration errors on initial page load', async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    // React hydration errors show as warnings or errors with these patterns
    if (
      (msg.type() === 'error' || msg.type() === 'warning') &&
      (text.includes('Hydration') ||
        text.includes('hydrating') ||
        text.includes('server-rendered HTML') ||
        text.includes('did not match'))
    ) {
      hydrationErrors.push(text);
    }
  });

  await page.goto('/');
  // Wait for hydration to complete
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });

  // Allow a tick for any deferred console messages
  await page.waitForTimeout(500);

  expect(hydrationErrors).toEqual([]);
});
