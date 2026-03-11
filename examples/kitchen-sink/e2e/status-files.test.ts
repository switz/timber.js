/**
 * E2E tests for MDX and JSON status-code file variants.
 *
 * Validates:
 * - MDX status files render correct markup with correct HTTP status codes
 * - JSON status files return application/json with correct status codes
 * - deny() in access.ts routes API requests to JSON status file
 * - Fallback chain resolves category file (4xx.json) when specific code missing
 * - Page routes prefer component chain over JSON (design/10-error-handling.md)
 *
 * Design docs: design/10-error-handling.md §"Status-Code File Variants"
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

// ─── MDX status files ─────────────────────────────────────────────────────

test.describe('MDX status files', () => {
  test('mdx 401 renders with status 401', async ({ page }) => {
    // /errors/mdx-test has page.tsx → deny(401) and co-located 401.mdx
    const response = await page.goto('/errors/mdx-test');
    expect(response?.status()).toBe(401);
    // 401.mdx should render as HTML with the MDX content
    await expect(page.locator('[data-testid="mdx-401-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="mdx-401-message"]')).toHaveText(
      'You must log in to access this page.'
    );
  });

  test('mdx status file returns HTML content-type', async ({ page }) => {
    const response = await page.goto('/errors/mdx-test');
    expect(response?.status()).toBe(401);
    // MDX status files are rendered through the React pipeline → HTML
    const contentType = response?.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });
});

// ─── JSON status files for API routes ─────────────────────────────────────

test.describe('JSON status files', () => {
  test('json 401 returns json with status 401', async ({ request }) => {
    // API route with access.ts → deny(401) and co-located 401.json
    const response = await request.get('/auth-test/api-guarded');
    expect(response.status()).toBe(401);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
    const body = await response.json();
    expect(body).toEqual({
      error: true,
      static: 'this is a static 401, but not cached',
    });
  });

  test('json status file returned verbatim (no React pipeline)', async ({ request }) => {
    const response = await request.get('/auth-test/api-guarded');
    expect(response.status()).toBe(401);
    const text = await response.text();
    // Must not contain HTML (no React rendering)
    expect(text).not.toContain('<html');
    expect(text).not.toContain('<!DOCTYPE');
    // Must be valid JSON
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

// ─── API route deny → JSON variant ───────────────────────────────────────

test.describe('API deny routes to JSON variant', () => {
  test('api deny returns json status file', async ({ request }) => {
    // API route at /auth-test/api-guarded has access.ts → deny(401)
    // and a co-located 401.json — should return JSON, not HTML
    const response = await request.get('/auth-test/api-guarded');
    expect(response.status()).toBe(401);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
  });

  test('api deny with no json file returns bare framework JSON', async ({ request }) => {
    // /api/deny-test has access.ts → deny(403), no 403.json in segment.
    // Parent /api/ has 4xx.json which catches it via fallback chain.
    const response = await request.get('/api/deny-test');
    expect(response.status()).toBe(403);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
  });
});

// ─── JSON fallback chain ─────────────────────────────────────────────────

test.describe('JSON fallback chain', () => {
  test('fallback to 4xx.json when 403.json missing', async ({ request }) => {
    // /api/deny-test has access.ts → deny(403)
    // No 403.json in that segment or parent. Parent /api/ has 4xx.json.
    // JSON chain: 403.json (miss) → 4xx.json (hit in /api/ segment)
    const response = await request.get('/api/deny-test');
    expect(response.status()).toBe(403);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
    const body = await response.json();
    // Should match the /api/4xx.json content
    expect(body).toEqual({
      error: 'Client Error',
      message: 'The request could not be processed.',
    });
  });

  test('specific json status file wins over category catch-all', async ({ request }) => {
    // /auth-test/api-guarded has deny(401) and co-located 401.json
    // Even though /api/401.json exists higher up, the leaf segment's file wins
    const response = await request.get('/auth-test/api-guarded');
    expect(response.status()).toBe(401);
    const body = await response.json();
    // This is the segment-level 401.json (has "static" field)
    expect(body.static).toBe('this is a static 401, but not cached');
    // Not the /api/401.json (which has "message" field)
    expect(body).not.toHaveProperty(
      'message',
      'Authentication required. Please provide a valid token.'
    );
  });
});

// ─── Page route component chain priority ─────────────────────────────────

test.describe('page route component chain priority', () => {
  test('page deny prefers component chain over json', async ({ page }) => {
    // /auth-test/deny-401-page-to-json has deny(401), page.tsx, and 401.json.
    // Component chain walks up to root error.tsx which handles 4xx denials.
    // Per design/10-error-handling.md: component chain runs fully before JSON.
    const response = await page.goto('/auth-test/deny-401-page-to-json');
    expect(response?.status()).toBe(401);
    // Root error.tsx catches it as a 4xx denial fallback (HTML, not JSON)
    const contentType = response?.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });
});
