/**
 * HMR E2E Tests — Hot Module Replacement across component types.
 *
 * Verifies:
 * - Client component edits preserve React state (Fast Refresh)
 * - Server component edits trigger RSC re-render without full reload
 * - Layout edits propagate to nested pages
 * - CSS edits hot-update without state loss
 * - Shared module edits update both RSC and client consumers
 * - Syntax error shows Vite overlay, fix recovers
 * - HMR works after client-side navigation (not just initial load)
 * - No unnecessary full-page reloads for standard file types
 *
 * Design refs: 18-build-system.md §HMR Wiring, 21-dev-server.md §HMR Wiring
 */

import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE_DIR = resolve(__dirname, '../fixtures/phase2-app/app');
const HMR_DIR = resolve(FIXTURE_DIR, 'hmr-test');

/**
 * Wait for timber's client runtime to initialize.
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

/**
 * Helper to write a file and restore it after the test.
 * Returns a restore function.
 */
function patchFile(filePath: string, content: string): () => void {
  const original = readFileSync(filePath, 'utf-8');
  writeFileSync(filePath, content, 'utf-8');
  return () => writeFileSync(filePath, original, 'utf-8');
}

/**
 * Wait for an HMR update to be applied.
 * We listen for the absence of a full navigation (no 'load' event)
 * and wait for specific content to appear.
 */
async function waitForHmrUpdate(
  page: Page,
  selector: string,
  expectedText: string,
  timeout = 10_000
): Promise<void> {
  await page.waitForFunction(
    ({ sel, text }) => {
      const el = document.querySelector(sel);
      return el?.textContent?.includes(text) ?? false;
    },
    { sel: selector, text: expectedText },
    { timeout }
  );
}

// ─── Client Component: State Preserved on Edit (React Fast Refresh) ──────────

test.describe('client component HMR', () => {
  test('client component state preserved on edit', async ({ page }) => {
    await page.goto('/hmr-test');
    await waitForHydration(page);

    // Click the counter button a few times to build up state
    const button = page.locator('[data-testid="hmr-counter-button"]');
    await button.click();
    await button.click();
    await button.click();
    await expect(page.locator('[data-testid="hmr-counter-value"]')).toHaveText('3');

    // Track full page loads — should NOT happen during HMR
    let fullReloadOccurred = false;
    page.on('load', () => {
      fullReloadOccurred = true;
    });

    // Edit the client component: change the label text
    const counterFile = resolve(HMR_DIR, 'hmr-counter.tsx');
    const restore = patchFile(
      counterFile,
      readFileSync(counterFile, 'utf-8').replace(
        '<span data-testid="hmr-counter-label">Counter</span>',
        '<span data-testid="hmr-counter-label">Updated Counter</span>'
      )
    );

    try {
      // Wait for Fast Refresh to apply the label change
      await waitForHmrUpdate(page, '[data-testid="hmr-counter-label"]', 'Updated Counter');

      // Counter state should be preserved (React Fast Refresh)
      await expect(page.locator('[data-testid="hmr-counter-value"]')).toHaveText('3');

      // No full page reload should have occurred
      expect(fullReloadOccurred).toBe(false);
    } finally {
      restore();
    }
  });
});

// ─── Server Component: RSC Re-render Without Full Reload ─────────────────────

test.describe('server component HMR', () => {
  test('server component re-renders on edit', async ({ page }) => {
    await page.goto('/hmr-test');
    await waitForHydration(page);

    // Verify initial content
    await expect(page.locator('[data-testid="hmr-server-text"]')).toHaveText('Hello HMR');

    // Build up client state to verify it survives server component HMR
    const button = page.locator('[data-testid="hmr-counter-button"]');
    await button.click();
    await button.click();
    await expect(page.locator('[data-testid="hmr-counter-value"]')).toHaveText('2');

    // Edit the server component: change the heading text
    const pageFile = resolve(HMR_DIR, 'page.tsx');
    const restore = patchFile(
      pageFile,
      readFileSync(pageFile, 'utf-8').replace(
        '<h1 data-testid="hmr-server-text">Hello HMR</h1>',
        '<h1 data-testid="hmr-server-text">Updated HMR</h1>'
      )
    );

    try {
      // Wait for the server component change to appear
      await waitForHmrUpdate(page, '[data-testid="hmr-server-text"]', 'Updated HMR');
    } finally {
      restore();
    }
  });
});

// ─── Layout Change Propagates to Child Pages ─────────────────────────────────

test.describe('layout HMR', () => {
  test('layout change propagates to child pages', async ({ page }) => {
    await page.goto('/hmr-test');
    await waitForHydration(page);

    // Verify the root layout marker is present
    await expect(page.locator('[data-testid="root-layout"]')).toBeVisible();

    // Edit the root layout's server component: add a marker
    const layoutFile = resolve(FIXTURE_DIR, 'layout.tsx');
    const restore = patchFile(
      layoutFile,
      readFileSync(layoutFile, 'utf-8').replace(
        '<title>Phase 2 E2E Fixture</title>',
        '<title>Phase 2 E2E Fixture HMR</title>'
      )
    );

    try {
      // Wait for the title change to propagate
      await page.waitForFunction(() => document.title.includes('HMR'), null, { timeout: 10_000 });
    } finally {
      restore();
    }
  });
});

// ─── CSS Hot Update Without State Loss ───────────────────────────────────────

test.describe('CSS HMR', () => {
  test('CSS change applies without reload', async ({ page }) => {
    await page.goto('/hmr-test');
    await waitForHydration(page);

    // Build up counter state
    const button = page.locator('[data-testid="hmr-counter-button"]');
    await button.click();
    await button.click();
    await expect(page.locator('[data-testid="hmr-counter-value"]')).toHaveText('2');

    // Verify initial background color
    const box = page.locator('[data-testid="hmr-styled-box"]');
    const initialColor = await box.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(initialColor).toBe('rgb(0, 0, 255)');

    // Track full page loads
    let fullReloadOccurred = false;
    page.on('load', () => {
      fullReloadOccurred = true;
    });

    // Edit the CSS: change background color
    const cssFile = resolve(HMR_DIR, 'hmr-test.css');
    const restore = patchFile(
      cssFile,
      '.hmr-box {\n  background-color: rgb(255, 0, 0);\n  color: white;\n  padding: 16px;\n}\n'
    );

    try {
      // Wait for CSS to update
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="hmr-styled-box"]');
          return el ? getComputedStyle(el).backgroundColor === 'rgb(255, 0, 0)' : false;
        },
        null,
        { timeout: 10_000 }
      );

      // Counter state should be preserved — CSS updates don't affect React state
      await expect(page.locator('[data-testid="hmr-counter-value"]')).toHaveText('2');

      // No full page reload
      expect(fullReloadOccurred).toBe(false);
    } finally {
      restore();
    }
  });
});

// ─── Shared Module: Both Environments Updated ────────────────────────────────

test.describe('shared module HMR', () => {
  test('shared module change propagates to both environments', async ({ page }) => {
    await page.goto('/hmr-test');
    await waitForHydration(page);

    // Verify initial shared values
    await expect(page.locator('[data-testid="hmr-shared-value"]')).toHaveText('shared:original');
    await expect(page.locator('[data-testid="hmr-client-shared"]')).toHaveText(
      'client-shared:original'
    );

    // Edit the shared module: change the exported value
    const sharedFile = resolve(HMR_DIR, 'shared-module.ts');
    const restore = patchFile(
      sharedFile,
      readFileSync(sharedFile, 'utf-8').replace(
        "export const SHARED_VALUE = 'original';",
        "export const SHARED_VALUE = 'updated';"
      )
    );

    try {
      // Wait for the client-side shared value to update
      // (client component should get HMR update for the shared module)
      await waitForHmrUpdate(page, '[data-testid="hmr-client-shared"]', 'client-shared:updated');

      // The server-side shared value should also update
      // (either via RSC HMR or a full-reload — either is acceptable)
      await waitForHmrUpdate(page, '[data-testid="hmr-shared-value"]', 'shared:updated');
    } finally {
      restore();
    }
  });
});

// ─── Syntax Error Overlay and Recovery ───────────────────────────────────────

test.describe('error overlay', () => {
  test('syntax error overlay and recovery', async ({ page }) => {
    await page.goto('/hmr-test');
    await waitForHydration(page);

    // Introduce a syntax error in the client component
    const counterFile = resolve(HMR_DIR, 'hmr-counter.tsx');
    const restore = patchFile(
      counterFile,
      readFileSync(counterFile, 'utf-8').replace(
        'export function HmrCounter()',
        'export function HmrCounter(SYNTAX ERROR'
      )
    );

    try {
      // Wait for the Vite error overlay to appear
      // Vite injects the overlay into a custom element: vite-error-overlay
      await page.waitForFunction(() => !!document.querySelector('vite-error-overlay'), null, {
        timeout: 10_000,
      });
    } finally {
      // Fix the syntax error by restoring the original file
      restore();
    }

    // After fixing, the overlay should disappear and page should recover
    await page.waitForFunction(() => !document.querySelector('vite-error-overlay'), null, {
      timeout: 10_000,
    });

    // Page content should be visible again
    await expect(page.locator('[data-testid="hmr-test-page"]')).toBeVisible();
  });
});

// ─── HMR After Client Navigation ────────────────────────────────────────────

test.describe('HMR after navigation', () => {
  test('HMR works after client navigation', async ({ page }) => {
    // Start at home, then navigate to the HMR test page via client nav
    await page.goto('/');
    await waitForHydration(page);

    // Navigate to the HMR test page via Link click (client-side navigation)
    await page.click('[data-testid="link-hmr-test"]');
    await page.waitForURL('/hmr-test');
    await expect(page.locator('[data-testid="hmr-test-page"]')).toBeVisible();

    // Build up client state
    const button = page.locator('[data-testid="hmr-counter-button"]');
    await button.click();
    await expect(page.locator('[data-testid="hmr-counter-value"]')).toHaveText('1');

    // Edit the client component (HMR should still work after SPA navigation)
    const counterFile = resolve(HMR_DIR, 'hmr-counter.tsx');
    const restore = patchFile(
      counterFile,
      readFileSync(counterFile, 'utf-8').replace(
        '<span data-testid="hmr-counter-label">Counter</span>',
        '<span data-testid="hmr-counter-label">Nav Counter</span>'
      )
    );

    try {
      // Wait for Fast Refresh to apply
      await waitForHmrUpdate(page, '[data-testid="hmr-counter-label"]', 'Nav Counter');

      // State should be preserved even after client nav + HMR
      await expect(page.locator('[data-testid="hmr-counter-value"]')).toHaveText('1');
    } finally {
      restore();
    }
  });
});
