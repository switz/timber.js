/**
 * E2E tests for metadata resolution: title templates, absolute titles, generateMetadata.
 *
 * Validates:
 * - Page title applies nearest ancestor template
 * - title.absolute skips template
 * - generateMetadata produces dynamic title
 * - Metadata present in no-JS SSR response
 *
 * Design docs: design/16-metadata.md
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
  test('metadata present in no-JS response', async ({ request }) => {
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
