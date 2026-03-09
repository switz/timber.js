import { test, expect } from '@playwright/test';

test('placeholder: Playwright E2E suite runs', () => {
  // Minimal smoke test so the E2E CI job doesn't fail with
  // "no tests found". Replace with real app tests once a dev
  // server fixture is wired up.
  expect(1 + 1).toBe(2);
});
