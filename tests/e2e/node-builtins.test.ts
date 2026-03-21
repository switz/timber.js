/**
 * E2E tests for Node.js builtin availability in server components.
 *
 * Regression test for LOCAL-327: RSC environment must have full Node.js
 * builtin access (AsyncLocalStorage, crypto, fs) in server components.
 */
import { test, expect } from '@playwright/test';

test('Node.js builtins work in server components', async ({ page }) => {
  const response = await page.goto('/node-builtins-test');
  expect(response?.status()).toBe(200);

  // node:crypto — randomUUID() produces a valid UUID
  const uuid = await page.locator('[data-testid="uuid"]').textContent();
  expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  // node:async_hooks — AsyncLocalStorage works
  const alsValue = await page.locator('[data-testid="als-value"]').textContent();
  expect(alsValue).toBe('test-value');
});
