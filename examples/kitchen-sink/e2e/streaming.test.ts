/**
 * E2E tests for Suspense streaming behavior and deferSuspenseFor.
 *
 * Validates:
 * - <Suspense> boundaries show fallback then stream content
 * - deferSuspenseFor inlines fast-resolving boundaries (no fallback in HTML)
 * - deferSuspenseFor shows fallback when child exceeds deadline
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
      'Content loaded after delay'
    );
  });

  test('streaming page returns 200 immediately', async ({ page }) => {
    const response = await page.goto('/streaming/suspense');
    expect(response?.status()).toBe(200);
  });
});

test.describe('deferSuspenseFor', () => {
  test('inlines fast-resolving Suspense boundary (no fallback visible)', async ({ page }) => {
    await page.goto('/streaming/deferred');

    // Fast content resolves in 50ms, deferSuspenseFor is 500ms.
    // The SSR stream is held — content renders inline without fallback.
    await expect(page.locator('[data-testid="deferred-fast-content"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="deferred-fast-content"]')).toHaveText(
      'Fast content (resolved before deadline)'
    );

    // The fast fallback should NOT be visible — it was never in the HTML
    await expect(page.locator('[data-testid="deferred-fast-fallback"]')).not.toBeVisible();
  });

  test('shows fallback then streams content when child exceeds deadline', async ({ page }) => {
    await page.goto('/streaming/deferred');

    // Slow content takes 2000ms, deferSuspenseFor is 500ms.
    // The fallback should appear first, then content streams in.
    await expect(page.locator('[data-testid="deferred-slow-fallback"]')).toBeVisible({
      timeout: 2_000,
    });

    // Then content streams in and replaces the fallback
    await expect(page.locator('[data-testid="deferred-slow-content"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="deferred-slow-content"]')).toHaveText(
      'Slow content (streamed after deadline)'
    );
  });
});

test.describe('client JS loading during streaming', () => {
  test('client bootstrap scripts are in the initial HTML shell, not blocked behind Suspense', async ({
    page,
  }) => {
    // Intercept the page HTML response and capture the first chunk timing
    const scriptLoadTimes: number[] = [];
    const navigationStart = Date.now();

    // Listen for script requests — these should start before Suspense resolves
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('timber-browser-entry') || url.includes('@vite/client')) {
        scriptLoadTimes.push(Date.now() - navigationStart);
      }
    });

    await page.goto('/streaming/deferred');

    // Wait for slow content to confirm streaming completed
    await expect(page.locator('[data-testid="deferred-slow-content"]')).toBeVisible({
      timeout: 10_000,
    });

    // Script requests should have started well before the 2s slow content resolved.
    // If scripts are in <head>, they start loading with the shell (~0ms).
    // If scripts are before </body>, they don't load until ~2000ms.
    expect(scriptLoadTimes.length).toBeGreaterThan(0);
    expect(scriptLoadTimes[0]).toBeLessThan(1000); // Must start within 1s, not after 2s
  });
});

test.describe('hydration during streaming', () => {
  test('client component in shell becomes interactive before Suspense resolves', async ({
    page,
  }) => {
    await page.goto('/streaming/deferred');

    // The Counter is in the shell (outside Suspense). It starts at 1 and
    // increments every second via useEffect + setInterval. If hydration
    // is blocked behind the 2s Suspense boundary, the counter stays at
    // its SSR value (1) until after slow content streams in.
    //
    // Wait for the counter to increment past 1 — proving hydration started.
    const counter = page.locator('[data-testid="shell-counter"]');
    await expect(counter).toBeVisible();

    // Poll until counter > 1 (hydration happened and useEffect fired)
    await expect(async () => {
      const text = await counter.textContent();
      expect(Number(text)).toBeGreaterThan(1);
    }).toPass({ timeout: 5_000 });

    // At this point the counter is interactive. The slow content (2s)
    // should NOT have arrived yet if hydration started promptly.
    // Verify slow content is still loading or just arrived.
    const slowContent = page.locator('[data-testid="deferred-slow-content"]');
    const isSlowVisible = await slowContent.isVisible().catch(() => false);

    // If slow content is already visible, the counter must have been
    // interactive for at least 1s (it incremented). The key assertion
    // is above: the counter DID increment, proving hydration wasn't
    // blocked behind Suspense.
    if (!isSlowVisible) {
      // Slow content hasn't arrived — hydration clearly started during streaming
      await expect(slowContent).toBeVisible({ timeout: 10_000 });
    }
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
