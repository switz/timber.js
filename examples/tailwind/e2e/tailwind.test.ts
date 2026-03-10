/**
 * E2E tests for the Tailwind CSS example app.
 *
 * Verifies that Tailwind CSS classes are compiled and applied correctly
 * when using @tailwindcss/vite with timber.js.
 *
 * Run: pnpm run test:e2e:tailwind
 */
import { test, expect } from '@playwright/test';

test('home page loads with 200 status', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
});

test('page content renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="tailwind-page"]')).toBeVisible();
  await expect(page.locator('[data-testid="tailwind-heading"]')).toHaveText('Timber + Tailwind');
});

test('Tailwind utility classes produce computed styles', async ({ page }) => {
  await page.goto('/');

  // The body has className="bg-white text-gray-900 antialiased"
  // bg-white → background-color: rgb(255, 255, 255)
  const body = page.locator('[data-testid="tailwind-body"]');
  const bgColor = await body.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgColor).toBe('rgb(255, 255, 255)');

  // text-gray-900 → color should be a dark gray (oklch or rgb)
  const color = await body.evaluate((el) => getComputedStyle(el).color);
  // Tailwind v4 uses oklch, but browsers compute to rgb — just verify it's dark
  expect(color).not.toBe('rgb(0, 0, 0)'); // not browser default black
  expect(color).toBeTruthy();
});

test('heading has Tailwind font styles applied', async ({ page }) => {
  await page.goto('/');

  const heading = page.locator('[data-testid="tailwind-heading"]');
  const fontWeight = await heading.evaluate((el) => getComputedStyle(el).fontWeight);
  // font-bold → 700
  expect(fontWeight).toBe('700');
});

test('layout has flex centering applied', async ({ page }) => {
  await page.goto('/');

  const container = page.locator('[data-testid="tailwind-page"]');
  const display = await container.evaluate((el) => getComputedStyle(el).display);
  // flex → display: flex
  expect(display).toBe('flex');
});

test('CSS is present in the page (style tag or stylesheet link)', async ({ page }) => {
  await page.goto('/');

  // In dev mode, Vite injects CSS via <style> tags. Verify CSS is present.
  const hasCss = await page.evaluate(() => {
    const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
    return styles.length > 0;
  });
  expect(hasCss).toBe(true);
});

test('metadata is rendered in the head', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Timber + Tailwind');
});
