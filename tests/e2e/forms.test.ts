/**
 * Phase 2 E2E Tests — Forms
 *
 * Tests progressive enhancement of forms: forms must work without JavaScript
 * (curl POST / no-JS browser), and enhanced with JS for inline RSC updates.
 *
 * Design docs: design/08-forms-and-actions.md, design/07-routing.md
 *
 * See also: tests/e2e/server-actions.test.ts for comprehensive server action
 * lifecycle tests (validation, revalidation, CSRF, error handling).
 */

import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });
}

// ─── No-JS Forms ────────────────────────────────────────────────────────────

test.describe('no-js forms', () => {
  test('form submission without JavaScript performs POST and redirect', async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      extraHTTPHeaders: { 'x-test-session': randomUUID() },
    });
    const page = await context.newPage();

    await page.goto('/todos');
    await page.fill('[data-testid="todo-input"]', 'Buy groceries');
    await page.click('[data-testid="todo-submit"]');

    await expect(page).toHaveURL('/todos');
    await expect(page.locator('text=Buy groceries')).toBeVisible();

    await context.close();
  });

  test('form works with JS enabled (enhanced with RSC inline update)', async ({ context, page }) => {
    await context.setExtraHTTPHeaders({ 'x-test-session': randomUUID() });
    await page.goto('/todos');
    await waitForHydration(page);

    await page.fill('[data-testid="todo-input"]', 'Buy milk');
    await page.click('[data-testid="todo-submit"]');

    await expect(page.locator('text=Buy milk')).toBeVisible();
    await expect(page).toHaveURL('/todos');
  });

  test('form validation errors shown inline with JS', async ({ context, page }) => {
    await context.setExtraHTTPHeaders({ 'x-test-session': randomUUID() });
    await page.goto('/todos');
    await waitForHydration(page);

    await page.click('[data-testid="todo-submit"]');
    await expect(page.locator('[data-testid="validation-error"]')).toBeVisible();
  });
});

// ─── Server Action CSRF Protection ──────────────────────────────────────────

test.describe('csrf protection', () => {
  test('cross-origin form POST is rejected with 403', async ({ request }) => {
    const response = await request.post('/todos', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://evil.com',
      },
      data: 'title=hacked',
    });

    expect(response.status()).toBe(403);
  });

  test('same-origin form POST is accepted', async ({ request }) => {
    const response = await request.post('/todos', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'http://localhost:3000',
      },
      data: 'title=Buy+groceries',
    });

    expect([200, 302]).toContain(response.status());
  });
});

// ─── Revalidation After Action ──────────────────────────────────────────────

test.describe('revalidation', () => {
  test('revalidatePath triggers inline RSC update after action', async ({ context, page }) => {
    await context.setExtraHTTPHeaders({ 'x-test-session': randomUUID() });
    await page.goto('/todos');
    await waitForHydration(page);

    await page.fill('[data-testid="todo-input"]', 'Test revalidation');
    await page.click('[data-testid="todo-submit"]');

    await expect(page.locator('text=Test revalidation')).toBeVisible();

    const layoutMarker = await page.getAttribute('[data-testid="layout-marker"]', 'data-id');
    expect(layoutMarker).toBeDefined();
  });
});
