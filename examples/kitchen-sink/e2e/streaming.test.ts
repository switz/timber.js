/**
 * E2E tests for Suspense and DeferredSuspense streaming behavior.
 *
 * Validates:
 * - <Suspense> boundaries show fallback then stream content
 * - <DeferredSuspense> renders inline when child resolves before deadline
 * - <DeferredSuspense> shows fallback when child exceeds deadline (blocked on timber-93u)
 * - deny() inside Suspense returns HTTP 200 (blocked on timber-93u)
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
  test('DeferredSuspense renders inline when child resolves before deadline', async ({ page }) => {
    await page.goto('/streaming/deferred');

    // Fast content (50ms delay, 500ms deadline) should render inline — no fallback shown.
    await expect(page.locator('[data-testid="deferred-fast-content"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="deferred-fast-content"]')).toHaveText(
      'Fast content (resolved before deadline)',
    );
  });

  // Blocked on timber-93u: RSC stream is fully buffered before SSR.
  // DeferredSuspense fallback never shows because the stream is not flushed progressively.
  test.skip('DeferredSuspense shows fallback when child exceeds deadline', async ({ page }) => {
    await page.goto('/streaming/deferred');

    // Slow content (2000ms delay, 500ms deadline) — fallback should appear after ~500ms,
    // then content streams in after ~2000ms.
    await expect(page.locator('[data-testid="deferred-slow-fallback"]')).toBeVisible({
      timeout: 5_000,
    });

    // Then the actual content streams in
    await expect(page.locator('[data-testid="deferred-slow-content"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="deferred-slow-content"]')).toHaveText(
      'Slow content (streamed after deadline)',
    );
  });
});

// Blocked on timber-93u: RSC stream is fully buffered, so deny() inside Suspense
// is always caught by bufferRscStream and produces the deny status code.
// Progressive streaming is needed to distinguish deny inside vs outside Suspense.
test.describe('deny inside Suspense', () => {
  test.skip('deny inside Suspense returns 200 status', async ({ page }) => {
    const response = await page.goto('/streaming/deny-inside');
    expect(response?.status()).toBe(200);
  });

  test.skip('page shell renders despite deny inside Suspense', async ({ page }) => {
    await page.goto('/streaming/deny-inside');
    await expect(page.locator('[data-testid="page-shell"]')).toBeVisible();
    await expect(page.locator('[data-testid="page-shell"]')).toHaveText(
      'This page shell renders with 200 status.',
    );
  });
});
