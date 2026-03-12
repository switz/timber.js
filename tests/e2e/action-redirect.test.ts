/**
 * Server Action Redirect E2E Tests
 *
 * Tests that redirect() from server actions performs client-side SPA
 * navigation (with-JS) or HTTP 302 redirect (no-JS).
 *
 * Design doc: design/08-forms-and-actions.md §"redirect()"
 */

import { test, expect, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

// ─── With-JS: SPA Navigation ────────────────────────────────────────────────

test.describe('action redirect with JS (SPA)', () => {
  test('redirect() from action performs client-side navigation', async ({ page }) => {
    await page.goto('/action-redirect-test');
    await waitForHydration(page);

    // Capture the layout marker to verify no full page reload
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="layout-marker"]')?.getAttribute('data-id') != null
    );
    const layoutMarker = await page.getAttribute('[data-testid="layout-marker"]', 'data-id');

    await page.click('[data-testid="redirect-submit"]');

    // Should navigate to the target page via SPA
    await expect(page).toHaveURL('/action-redirect-test/target');
    await expect(page.locator('[data-testid="redirect-target-heading"]')).toBeVisible();

    // Layout marker should be preserved (no full page reload)
    const afterMarker = await page.getAttribute('[data-testid="layout-marker"]', 'data-id');
    expect(afterMarker).toBe(layoutMarker);
  });

  test('action response has X-Timber-Redirect header', async ({ page }) => {
    await page.goto('/action-redirect-test');
    await waitForHydration(page);

    const actionResponsePromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.request().headers()['x-rsc-action'] != null
    );

    await page.click('[data-testid="redirect-submit"]');

    const actionResponse = await actionResponsePromise;
    expect(actionResponse.headers()['x-timber-redirect']).toBe('/action-redirect-test/target');
    expect(actionResponse.status()).toBe(200); // NOT 302
  });
});

// ─── No-JS: HTTP 302 Redirect ───────────────────────────────────────────────

test.describe('action redirect without JS (302)', () => {
  test('redirect() from action returns HTTP 302 for no-JS form submission', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/action-redirect-test');

    await page.click('[data-testid="redirect-submit"]');

    // Playwright follows the 302 automatically — should land on target
    await expect(page).toHaveURL('/action-redirect-test/target');
    await expect(page.locator('[data-testid="redirect-target-heading"]')).toBeVisible();

    await context.close();
  });
});
