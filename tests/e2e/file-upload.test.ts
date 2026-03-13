/**
 * E2E Tests — File Upload via Server Actions
 *
 * Tests file upload through schema-validated server actions:
 * - With JS: inline success message after file upload
 * - No JS: file upload via standard form POST
 * - Schema validation works with File objects
 *
 * Design doc: design/08-forms-and-actions.md
 */

import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

// Create a temp test file for uploads
const TMP_DIR = join(import.meta.dirname!, '..', '..', 'tmp-test-files');
const TEST_FILE = join(TMP_DIR, 'test-upload.txt');

test.beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TEST_FILE, 'Hello from test file upload!');
});

test.afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ─── With-JS Tests ──────────────────────────────────────────────────────

test.describe('file upload (with JS)', () => {
  test('uploads file through schema-validated action', async ({ page }) => {
    await page.goto('/file-upload');
    await waitForHydration(page);

    await page.fill('[data-testid="title-input"]', 'My Upload');
    await page.setInputFiles('[data-testid="avatar-input"]', TEST_FILE);
    await page.click('[data-testid="upload-submit"]');

    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="success-message"]')).toContainText('My Upload');
    await expect(page.locator('[data-testid="success-message"]')).toContainText(
      'test-upload.txt'
    );
  });

  test('shows validation error when title is missing', async ({ page }) => {
    await page.goto('/file-upload');
    await waitForHydration(page);

    // Submit without filling title
    await page.click('[data-testid="upload-submit"]');

    await expect(page.locator('[data-testid="title-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="title-error"]')).toContainText('Title is required');
  });

  test('succeeds without file (file is optional)', async ({ page }) => {
    await page.goto('/file-upload');
    await waitForHydration(page);

    await page.fill('[data-testid="title-input"]', 'No File Upload');
    await page.click('[data-testid="upload-submit"]');

    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="success-message"]')).toContainText('no file');
  });
});

// ─── No-JS Tests ────────────────────────────────────────────────────────

test.describe('file upload (no JS)', () => {
  test('uploads file via standard form POST', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/file-upload');
    await page.fill('[data-testid="title-input"]', 'No-JS Upload');
    await page.setInputFiles('[data-testid="avatar-input"]', TEST_FILE);
    await page.click('[data-testid="upload-submit"]');

    // Should show the success message (re-rendered page with flash data)
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="success-message"]')).toContainText('No-JS Upload');

    await context.close();
  });

  test('shows validation error without JS when title is missing', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/file-upload');
    // Submit without title
    await page.click('[data-testid="upload-submit"]');

    // Should re-render with validation errors (no redirect)
    await expect(page.locator('[data-testid="title-error"]')).toBeVisible();

    await context.close();
  });
});
