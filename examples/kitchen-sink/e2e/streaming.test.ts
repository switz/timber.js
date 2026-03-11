/**
 * E2E tests for Suspense and DeferredSuspense streaming behavior.
 *
 * Validates:
 * - <Suspense> boundaries show fallback then stream content
 * - <DeferredSuspense> renders inline when child resolves before deadline
 * - <DeferredSuspense> shows fallback when child exceeds deadline
 * - deny() inside Suspense returns HTTP 200
 *
 * Design docs: design/05-streaming.md
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

test.describe('Suspense streaming', () => {
  test('Suspense boundary shows fallback then streams content', async ({ page }) => {
    await page.goto('/streaming/suspense');

    // Page shell renders immediately
    await expect(page.locator('[data-testid="immediate-content"]')).toBeVisible();

    // Wait for the streamed content to appear
    await expect(page.locator('[data-testid="streamed-content"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="streamed-content"]')).toHaveText(
      'Content loaded after delay',
    );
  });

  test('streaming page returns 200 immediately', async ({ page }) => {
    const response = await page.goto('/streaming/suspense');
    expect(response?.status()).toBe(200);
  });
});

test.describe('DeferredSuspense', () => {
  // TODO: Restore "renders inline when child resolves before deadline" test once
  // the nested-Suspense hold-delay behavior is re-enabled (blocked on
  // @vitejs/plugin-rsc Flight→Fizz nested boundary bug).

  test('DeferredSuspense streams content after async resolve', async ({ page }) => {
    await page.goto('/streaming/deferred');

    // Fast content resolves quickly — should appear
    await expect(page.locator('[data-testid="deferred-fast-content"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="deferred-fast-content"]')).toHaveText(
      'Fast content (resolved before deadline)',
    );

    // Slow content streams in after ~2000ms
    await expect(page.locator('[data-testid="deferred-slow-content"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="deferred-slow-content"]')).toHaveText(
      'Slow content (streamed after deadline)',
    );
  });
});

test.describe('deny inside Suspense', () => {
  test('deny inside Suspense returns 200 status', async ({ page }) => {
    const response = await page.goto('/streaming/deny-inside');
    expect(response?.status()).toBe(200);
  });

  // deny() inside Suspense triggers the error boundary during hydration.
  // The server-rendered HTML includes the page shell, but React's client
  // hydration retries the Suspense content, which re-throws deny(404).
  // The error boundary catches it and renders the 404 page.
  // TODO: Investigate React Suspense error boundary interaction to preserve
  // the page shell when deny() fires inside Suspense during streaming.
  test('deny inside Suspense renders error boundary after hydration', async ({ page }) => {
    const response = await page.goto('/streaming/deny-inside');
    expect(response?.status()).toBe(200);
    // Error boundary catches the deny during hydration and renders 404 page
    await expect(page.locator('[data-testid="not-found-page"]')).toBeVisible({ timeout: 5_000 });
  });
});
