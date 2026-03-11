/**
 * E2E tests for error handling: error.tsx, status-code files, RenderError, deny().
 *
 * Validates:
 * - deny(403) returns HTTP 403 and renders 403.tsx
 * - deny(401) returns HTTP 401 and renders error.tsx as 4xx fallback
 * - deny(404) renders custom 404.tsx (blocked on timber-8u4: no-match 404 rendering)
 * - Unhandled throw renders error.tsx with 500 status (blocked on timber-8u4: error boundary component)
 * - RenderError renders error boundary with typed digest (blocked on timber-8u4: digest serialization)
 *
 * Design docs: design/10-error-handling.md
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

test.describe('deny() status codes', () => {
  test('deny(403) returns 403 and renders status file', async ({ page }) => {
    const response = await page.goto('/errors/deny-403');
    expect(response?.status()).toBe(403);
    await expect(page.locator('[data-testid="forbidden-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="forbidden-heading"]')).toHaveText('403 — Forbidden');
  });

  test('deny(401) returns 401', async ({ page }) => {
    const response = await page.goto('/errors/deny-401');
    expect(response?.status()).toBe(401);
  });

  // Blocked on timber-8u4: pipeline returns bare 404 for no-match URLs
  // instead of rendering root 404.tsx in the root layout.
  test.skip('deny(404) renders custom 404 page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-testid="not-found-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="not-found-heading"]')).toHaveText(
      '404 — Page Not Found',
    );
  });
});

// Blocked on timber-8u4: error boundary component + RenderError digest serialization.
// The tree-builder creates `timber:error-boundary` string elements but there is no
// React class component to catch errors. Errors propagate unhandled to SSR.
test.describe('error.tsx boundary', () => {
  test.skip('unhandled error renders error.tsx with 500', async ({ page }) => {
    const response = await page.goto('/errors/crash');
    expect(response?.status()).toBe(500);
    await expect(page.locator('[data-testid="error-boundary"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-heading"]')).toHaveText('Something went wrong');
    await expect(page.locator('[data-testid="error-message"]')).toHaveText(
      'Intentional crash for E2E testing',
    );
  });

  test.skip('unhandled error does not have digest', async ({ page }) => {
    await page.goto('/errors/crash');
    await expect(page.locator('[data-testid="error-boundary"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-digest"]')).not.toBeVisible();
  });

  test.skip('RenderError renders error boundary with digest', async ({ page }) => {
    const response = await page.goto('/errors/render-error');
    expect(response?.status()).toBe(500);
    await expect(page.locator('[data-testid="error-boundary"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-digest"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-digest-code"]')).toHaveText(
      'PRODUCT_NOT_FOUND',
    );
    const data = await page.locator('[data-testid="error-digest-data"]').textContent();
    const parsed = JSON.parse(data!);
    expect(parsed).toEqual({ title: 'Product not found', resourceId: 'abc-123' });
  });
});
