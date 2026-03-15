/**
 * E2E tests for redirect() called inside a page component.
 *
 * Verifies that redirect() works both on initial page load (HTTP 302)
 * and during client-side navigation (SPA redirect).
 *
 * Regression test for TIM-344: redirect() in page component throws
 * on client during RSC navigation instead of performing the redirect.
 *
 * See design/10-error-handling.md §"redirect() — Two Contexts, One Function"
 */
import { test, expect, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

test.describe('redirect() in page component', () => {
  test('redirects on initial page load (HTTP 302)', async ({ request }) => {
    const response = await request.get('/page-redirect-test', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toBe('/page-redirect-test/target');
  });

  test('follows redirect on initial page load', async ({ page }) => {
    await page.goto('/page-redirect-test');
    await expect(page.locator('[data-testid="page-redirect-target"]')).toHaveText(
      'Redirect landed here'
    );
    expect(page.url()).toContain('/page-redirect-test/target');
  });

  test('performs client-side redirect during SPA navigation without full reload', async ({
    page,
  }) => {
    // Start on home page and hydrate
    await page.goto('/');
    await waitForHydration(page);

    // Type into the layout input to create DOM state we can verify
    const layoutInput = page.locator('[data-testid="layout-input"]');
    await layoutInput.fill('state-preserved');

    // Intercept RSC requests to verify we don't get errors in the stream
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate via Link click (client-side navigation)
    await page.click('[data-testid="link-page-redirect"]');

    // Should end up at the redirect target
    await expect(page.locator('[data-testid="page-redirect-target"]')).toBeVisible({
      timeout: 10_000,
    });
    expect(page.url()).toContain('/page-redirect-test/target');

    // Input value should be preserved — proves this was SPA navigation, not full reload
    await expect(layoutInput).toHaveValue('state-preserved');

    // Should not have client-side errors about the redirect.
    // Filter out SSR render error logs forwarded by Vite's dev server
    // (these come from other requests, not from this client navigation).
    const clientRedirectErrors = consoleErrors.filter(
      (e) => e.includes('Redirect') && !e.includes('SSR render error')
    );
    expect(clientRedirectErrors).toHaveLength(0);
  });

  test('RSC payload request returns redirect header, not error stream', async ({ request }) => {
    // Simulate an RSC payload request (what the client router sends during navigation)
    const response = await request.get('/page-redirect-test', {
      headers: {
        Accept: 'text/x-component',
      },
      maxRedirects: 0,
    });
    // Server should return 204 + X-Timber-Redirect for RSC payload requests
    expect(response.status()).toBe(204);
    expect(response.headers()['x-timber-redirect']).toBe('/page-redirect-test/target');
  });
});
