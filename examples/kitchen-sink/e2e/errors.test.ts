/**
 * E2E tests for error handling: error.tsx, status-code files, RenderError, deny().
 *
 * Validates:
 * - deny(403) returns HTTP 403 and renders 403.tsx
 * - deny(404) returns HTTP 404 and renders segment 404.tsx
 * - deny(401) returns HTTP 401 and renders error.tsx as 4xx fallback
 * - deny(404) renders custom 404.tsx for no-match URLs
 * - Multiple status files on one segment (403 + 404) each catch their status
 * - Client-side navigation between different error pages
 * - Unhandled throw renders error.tsx with 500 status
 * - RenderError renders error boundary with typed digest
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

  test('deny(404) returns 404 and renders segment status file', async ({ page }) => {
    const response = await page.goto('/errors/deny-404');
    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-testid="segment-not-found-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="segment-not-found-heading"]')).toHaveText(
      '404 — Not Found (Segment)',
    );
  });

  test('deny(401) returns 401', async ({ page }) => {
    const response = await page.goto('/errors/deny-401');
    expect(response?.status()).toBe(401);
  });

  test('deny(404) renders custom 404 page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.locator('[data-testid="not-found-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="not-found-heading"]')).toHaveText(
      '404 — Page Not Found',
    );
  });
});

test.describe('client-side navigation between error pages', () => {
  test('navigating from deny(403) to deny(401) updates error boundary', async ({ page }) => {
    // Server-render the 403 page first
    await page.goto('/errors/deny-403');
    await expect(page.locator('[data-testid="forbidden-page"]')).toBeVisible();

    // Client-navigate to 401 via nav link
    await page.click('[data-testid="link-errors-deny-401"]');
    // 401 falls through to error.tsx which renders denial-fallback
    await expect(page.locator('[data-testid="denial-fallback"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="denial-heading"]')).toHaveText('401 — Access Denied');
  });

  test('navigating from deny(401) to deny(403) updates error boundary', async ({ page }) => {
    await page.goto('/errors/deny-401');
    await expect(page.locator('[data-testid="denial-fallback"]')).toBeVisible();

    // Client-navigate to 403
    await page.click('[data-testid="link-errors-deny-403"]');
    await expect(page.locator('[data-testid="forbidden-page"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="forbidden-heading"]')).toHaveText('403 — Forbidden');
  });

  test('navigating from deny(403) to deny(404) switches to segment 404 page', async ({ page }) => {
    await page.goto('/errors/deny-403');
    await expect(page.locator('[data-testid="forbidden-page"]')).toBeVisible();

    // Client-navigate to 404
    await page.click('[data-testid="link-errors-deny-404"]');
    await expect(page.locator('[data-testid="segment-not-found-page"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="segment-not-found-heading"]')).toHaveText(
      '404 — Not Found (Segment)',
    );
    // 403 page should be gone
    await expect(page.locator('[data-testid="forbidden-page"]')).not.toBeVisible();
  });

  test('navigating from deny(404) to deny(403) switches to segment 403 page', async ({ page }) => {
    await page.goto('/errors/deny-404');
    await expect(page.locator('[data-testid="segment-not-found-page"]')).toBeVisible();

    // Client-navigate to 403
    await page.click('[data-testid="link-errors-deny-403"]');
    await expect(page.locator('[data-testid="forbidden-page"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="forbidden-heading"]')).toHaveText('403 — Forbidden');
    // 404 page should be gone
    await expect(page.locator('[data-testid="segment-not-found-page"]')).not.toBeVisible();
  });

  test('navigating from error page to normal page clears error', async ({ page }) => {
    await page.goto('/errors/deny-403');
    await expect(page.locator('[data-testid="forbidden-page"]')).toBeVisible();

    // Client-navigate to home
    await page.click('[data-testid="link-home"]');
    // Error boundary should clear, normal page renders
    await expect(page.locator('[data-testid="forbidden-page"]')).not.toBeVisible({ timeout: 5_000 });
  });
});

test.describe('error.tsx boundary', () => {
  test('unhandled error renders error.tsx with 500', async ({ page }) => {
    const response = await page.goto('/errors/crash');
    expect(response?.status()).toBe(500);
    await expect(page.locator('[data-testid="error-boundary"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-heading"]')).toHaveText('Something went wrong');
    await expect(page.locator('[data-testid="error-message"]')).toHaveText(
      'Intentional crash for E2E testing',
    );
  });

  test('unhandled error does not have digest', async ({ page }) => {
    await page.goto('/errors/crash');
    await expect(page.locator('[data-testid="error-boundary"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-digest"]')).not.toBeVisible();
  });

  test('RenderError renders error boundary with digest', async ({ page }) => {
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
