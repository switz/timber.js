/**
 * E2E tests for per-route middleware.ts behavior.
 *
 * Validates:
 * - middleware.ts sets response headers (Cache-Control, X-Test)
 * - middleware.ts injects request headers visible to page via headers()
 * - middleware.ts short-circuits with a custom Response
 *
 * Design docs: design/07-routing.md §middleware.ts
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

test.describe('middleware response headers', () => {
  test('middleware sets response headers', async ({ page }) => {
    const response = await page.goto('/middleware-test/headers');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toBe('private, max-age=0');
    expect(response?.headers()['x-test']).toBe('middleware-header-value');
    await expect(page.locator('[data-testid="middleware-headers-page"]')).toBeVisible();
  });
});

test.describe('middleware request header injection', () => {
  test('middleware injects request header visible to page', async ({ page }) => {
    const response = await page.goto('/middleware-test/inject');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="injected-locale"]')).toHaveText('en-US');
  });
});

test.describe('middleware short-circuit', () => {
  test('middleware short-circuit returns custom response', async ({ page }) => {
    const response = await page.goto('/middleware-test/short-circuit');
    expect(response?.status()).toBe(403);
    const body = await response?.text();
    expect(body).toContain('Forbidden by middleware');
  });
});
