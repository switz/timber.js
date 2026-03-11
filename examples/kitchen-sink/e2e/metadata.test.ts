/**
 * E2E tests for metadata resolution: title templates, absolute titles, generateMetadata,
 * and client-side title updates on SPA navigation.
 *
 * Validates:
 * - Page title applies nearest ancestor template
 * - title.absolute skips template
 * - generateMetadata produces dynamic title
 * - Metadata present in no-JS SSR response
 * - document.title updates on SPA navigation (via X-Timber-Head header)
 *
 * Design docs: design/16-metadata.md, design/19-client-navigation.md
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

test.describe('metadata title templates', () => {
  test('page title applies nearest ancestor template', async ({ page }) => {
    await page.goto('/meta-test');
    // Root layout template: '%s | Kitchen Sink'
    // Page title: 'Meta Test Page'
    // Resolved: 'Meta Test Page | Kitchen Sink'
    await expect(page).toHaveTitle('Meta Test Page | Kitchen Sink');
  });

  test('absolute title skips template', async ({ page }) => {
    await page.goto('/meta-test/absolute');
    // title.absolute: 'Absolute Title' — ignores template
    await expect(page).toHaveTitle('Absolute Title');
  });
});

test.describe('generateMetadata', () => {
  test('generateMetadata produces dynamic title', async ({ page }) => {
    await page.goto('/meta-test/abc');
    // generateMetadata returns title: 'Item abc'
    // Root template: '%s | Kitchen Sink'
    // Resolved: 'Item abc | Kitchen Sink'
    await expect(page).toHaveTitle('Item abc | Kitchen Sink');
    await expect(page.locator('[data-testid="meta-dynamic-id"]')).toHaveText('abc');
  });
});

test.describe('metadata in SSR', () => {
  test('renders correct title on SSR', async ({ request }) => {
    // Fetch the raw HTML without executing JS
    const response = await request.get('/meta-test');
    expect(response.status()).toBe(200);
    const html = await response.text();
    // Title tag should be present in the SSR HTML
    expect(html).toContain('<title>Meta Test Page | Kitchen Sink</title>');
    // Description meta tag should be present
    expect(html).toContain('Testing metadata with title template');
  });
});

test.describe('metadata on SPA navigation', () => {
  test('updates title on client navigation', async ({ page }) => {
    // Start on home page
    await page.goto('/');
    await expect(page).toHaveTitle('Kitchen Sink — timber.js');

    // Click link to /meta-test — SPA navigation via data-timber-link
    await page.click('a[href="/meta-test"]');
    await expect(page.locator('[data-testid="meta-test-heading"]')).toBeVisible();

    // Title should update via X-Timber-Head header
    await expect(page).toHaveTitle('Meta Test Page | Kitchen Sink');
  });

  test('applies title template on navigation', async ({ page }) => {
    // Start on absolute title page (no template)
    await page.goto('/meta-test/absolute');
    await expect(page).toHaveTitle('Absolute Title');

    // Navigate to /meta-test which uses the root template
    await page.click('a[href="/"]');
    await expect(page.locator('[data-testid="home-page"]')).toBeVisible();
    await page.click('a[href="/meta-test"]');
    await expect(page.locator('[data-testid="meta-test-heading"]')).toBeVisible();

    // Template should be applied: 'Meta Test Page | Kitchen Sink'
    await expect(page).toHaveTitle('Meta Test Page | Kitchen Sink');
  });

  test('absolute title skips template on navigation', async ({ page }) => {
    // Start on /meta-test (has template applied)
    await page.goto('/meta-test');
    await expect(page).toHaveTitle('Meta Test Page | Kitchen Sink');

    // Navigate to /meta-test/absolute via SPA link
    await page.click('a[href="/meta-test/absolute"]');
    await expect(page.locator('[data-testid="meta-absolute-page"]')).toBeVisible();

    // Absolute title should skip template
    await expect(page).toHaveTitle('Absolute Title');
  });

  test('dynamic generateMetadata title on navigation', async ({ page }) => {
    // Start on /meta-test
    await page.goto('/meta-test');
    await expect(page).toHaveTitle('Meta Test Page | Kitchen Sink');

    // Navigate to dynamic page via SPA link
    await page.click('a[href="/meta-test/abc"]');
    await expect(page.locator('[data-testid="meta-dynamic-id"]')).toHaveText('abc');

    // Dynamic title with template should be applied
    await expect(page).toHaveTitle('Item abc | Kitchen Sink');
  });
});
