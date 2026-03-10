/**
 * E2E tests for deny() in async server components.
 *
 * Verifies that deny(status) produces the correct HTTP status code
 * when called from async server components (where the throw happens
 * during stream consumption, not stream creation).
 */
import { test, expect } from '@playwright/test';

test('deny(404) in async server component returns 404 status', async ({ page }) => {
  const response = await page.goto('/deny-test');
  expect(response?.status()).toBe(404);
});

test('deny(404) does not return 500', async ({ page }) => {
  const response = await page.goto('/deny-test');
  expect(response?.status()).not.toBe(500);
});
