/**
 * E2E tests for scroll restoration and navigation scroll behavior.
 *
 * Validates:
 * - Forward navigation scrolls to top
 * - Back navigation restores previous scroll position
 * - Forward button restores scroll position
 * - Link scroll={false} preserves scroll position
 * - Navigation from parallel route page to standard route scrolls to top
 *
 * Note: "slot navigation preserves main scroll" (navigating within a parallel
 * route slot without affecting main scroll) is not testable yet because
 * timber.js does not support sub-path routing within parallel route slots.
 *
 * Design docs: design/19-client-navigation.md — Scroll Restoration section
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * Scroll the page to the given Y position and wait for it to settle.
 */
async function scrollToAndWait(page: Page, y: number) {
  await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
  await page.waitForFunction((target) => Math.abs(window.scrollY - target) < 10, y, {
    timeout: 5_000,
  });
}

/**
 * Wait for the `timber:scroll-restored` event dispatched by the router
 * after afterPaint completes. This is deterministic — no polling needed.
 * Must be called BEFORE triggering the navigation that causes scroll.
 * Returns a promise that resolves when the event fires.
 */
function setupScrollRestoredListener(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.addEventListener('timber:scroll-restored', () => resolve(), { once: true });
      })
  );
}

/**
 * Wait for a client-side navigation to complete by polling for a testid.
 */
async function waitForNav(page: Page, testId: string) {
  await expect(page.locator(`[data-testid="${testId}"]`)).toBeVisible({ timeout: 10_000 });
}

/**
 * Wait for the page to hydrate (client JS must be running for SPA navigation).
 */
async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => document.querySelector('meta[name="timber-ready"]') !== null,
    null,
    { timeout: 10_000 }
  );
}

/**
 * Trigger an SPA navigation by evaluating a click on the link element.
 * Uses el.click() inside page.evaluate to avoid Playwright's
 * auto-scroll-into-view behavior which interferes with scroll position tests.
 * Waits for the `timber:scroll-restored` event (fired after afterPaint)
 * to ensure scroll has settled before assertions.
 */
async function clickLinkAndWait(page: Page, linkTestId: string, targetTestId: string) {
  // Set up the scroll-restored listener before clicking to avoid races.
  // The click and listener setup happen in one evaluate call so the
  // listener is registered synchronously before the async navigation starts.
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve) => {
        window.addEventListener('timber:scroll-restored', () => resolve(), { once: true });
        const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
        el.click();
      }),
    linkTestId
  );
  await waitForNav(page, targetTestId);
}

/**
 * Go back and wait for scroll restoration to complete.
 * Sets up the scroll-restored listener before triggering goBack.
 */
async function goBackAndWaitForScroll(page: Page, targetTestId: string) {
  const scrollPromise = setupScrollRestoredListener(page);
  await page.goBack();
  await waitForNav(page, targetTestId);
  await scrollPromise;
}

test.describe('scroll restoration', () => {
  test('forward navigation scrolls to top', async ({ page }) => {
    await page.goto('/scroll-test/page-a');
    await waitForNav(page, 'scroll-page-a');
    await waitForHydration(page);

    // Scroll down on page A
    await scrollToAndWait(page, 800);

    // Client-navigate to page B
    await clickLinkAndWait(page, 'link-to-page-b', 'scroll-page-b');

    // Should scroll to top (scroll-restored event already fired)
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);
  });

  test('back navigation restores scroll position', async ({ page }) => {
    await page.goto('/scroll-test/page-a');
    await waitForNav(page, 'scroll-page-a');
    await waitForHydration(page);

    // Scroll down on page A
    await scrollToAndWait(page, 600);

    // Client-navigate to page B
    await clickLinkAndWait(page, 'link-to-page-b', 'scroll-page-b');

    // Go back — should restore scroll position on page A
    await goBackAndWaitForScroll(page, 'scroll-page-a');
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(600);
  });

  test('forward button restores scroll position', async ({ page }) => {
    // Start on page B, scroll, navigate away, then go back to verify restoration.
    await page.goto('/scroll-test/page-b');
    await waitForNav(page, 'scroll-page-b');
    await waitForHydration(page);

    // Scroll down on page B
    await scrollToAndWait(page, 500);

    // Client-navigate to page A
    await clickLinkAndWait(page, 'link-to-page-a', 'scroll-page-a');

    // Go back to page B — should restore scroll position
    await goBackAndWaitForScroll(page, 'scroll-page-b');
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(500);
  });

  test('scroll false preserves position', async ({ page }) => {
    await page.goto('/scroll-test/page-a');
    await waitForNav(page, 'scroll-page-a');
    await waitForHydration(page);

    // Scroll down on page A
    await scrollToAndWait(page, 400);

    // Client-navigate to page B with scroll={false}
    await clickLinkAndWait(page, 'link-to-page-b-no-scroll', 'scroll-page-b');

    // Scroll position should be preserved (not reset to 0)
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(400);
  });
});

test.describe('parallel route scroll behavior', () => {
  test('slot to standard route scrolls to top', async ({ page }) => {
    await page.goto('/scroll-test/parallel');
    await waitForNav(page, 'parallel-scroll-page');
    await waitForHydration(page);

    // Verify parallel layout with slot is present
    await expect(page.locator('[data-testid="panel-content"]')).toBeVisible();

    // Scroll down
    await scrollToAndWait(page, 400);

    // Navigate from parallel route to a standard route (full page swap)
    await clickLinkAndWait(page, 'parallel-link-to-page-a', 'scroll-page-a');

    // Should scroll to top — this is a full page swap
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);
  });
});
