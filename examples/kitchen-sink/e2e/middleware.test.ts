/**
 * E2E tests for per-route middleware.ts behavior.
 *
 * Validates:
 * - middleware.ts sets response headers (Cache-Control, X-Test)
 * - middleware.ts injects request headers visible to page via headers()
 * - middleware.ts short-circuits with a custom Response
 * - middleware.ts wraps route.ts API handlers
 * - middleware.ts error returns HTTP 500
 * - middleware.ts runs on client-side RSC navigation
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
    await expect(page.locator('[data-testid="injected-locale"]')).toHaveText(
      'timber-inject-test-value'
    );
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

test.describe('middleware wraps route.ts', () => {
  test('middleware runs before route.ts API handler', async ({ request }) => {
    const response = await request.get('/middleware-test/api');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-middleware-api']).toBe('applied');
    const json = await response.json();
    expect(json).toEqual({ ok: true, handler: 'api-route' });
  });
});

test.describe('middleware error handling', () => {
  test('middleware error returns 500', async ({ page }) => {
    const response = await page.goto('/middleware-test/error');
    expect(response?.status()).toBe(500);
  });
});

test.describe('middleware on client-side navigation', () => {
  test('middleware runs on client-side navigation', async ({ page }) => {
    // Start on the home page (no middleware for this route)
    await page.goto('/');
    await expect(page.locator('[data-testid="link-mw-nav-target"]')).toBeVisible();

    // Client-side navigate to nav-target which has middleware that injects
    // X-Nav-Timestamp into request headers — the page reads it via headers()
    // and renders the value. A non-empty timestamp proves middleware ran.
    await page.click('[data-testid="link-mw-nav-target"]');
    await expect(page.locator('[data-testid="middleware-nav-target-page"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="nav-timestamp"]')).not.toBeEmpty();
  });
});
