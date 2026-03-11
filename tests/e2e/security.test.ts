/**
 * E2E Tests — RSC Payload Security
 *
 * Verifies that server component source code is never leaked to the
 * client via the RSC Flight payload. React Flight's dev-mode debug
 * channel serializes component functions as `$E` entries — these must
 * be routed to a separate stream, not inlined in the HTML payload.
 *
 * Security checklist item #23 from design/13-security.md
 */

import { test, expect } from '@playwright/test';

// Matches React Flight's $E debug serialization of function source code.
// Pattern: `$EObject.defineProperty(function` or `$E(function`
const LEAKED_SOURCE_PATTERN = /\$E(?:Object\.defineProperty\()?(?:\()?function\s/;

test.describe('rsc payload source leak', () => {
  test('initial HTML does not contain server component source code', async ({ page }) => {
    // Intercept the raw HTML response before the browser parses it
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/') && res.status() === 200),
      page.goto('/'),
    ]);

    const html = await response!.text();

    // The HTML should contain rendered output but NOT function source code
    expect(html).toContain('data-testid="home-content"');
    expect(html).not.toMatch(LEAKED_SOURCE_PATTERN);
  });

  test('RSC payload during navigation does not contain server component source code', async ({
    page,
  }) => {
    await page.goto('/');
    // Wait for hydration so the click triggers SPA navigation (RSC fetch)
    // rather than a full page reload. browser-entry.ts appends a
    // <meta name="timber-ready"> tag after the router is initialized.
    await page.waitForSelector('meta[name="timber-ready"]', { state: 'attached', timeout: 15_000 });

    // Intercept the RSC payload response during client-side navigation
    const rscResponse = page.waitForResponse(
      (res) => res.headers()['content-type']?.includes('text/x-component') ?? false
    );

    await page.click('[data-testid="link-dashboard"]');

    const response = await rscResponse;
    const payload = await response.text();

    // RSC payload should contain rendered component output, not source code
    expect(payload).toContain('dashboard');
    expect(payload).not.toMatch(LEAKED_SOURCE_PATTERN);
  });
});
