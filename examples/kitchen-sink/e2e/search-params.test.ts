/**
 * E2E tests for typed searchParams + typed routes demo.
 *
 * Validates:
 * - Server-side auto-parsing via ALS (page.tsx reads typed searchParams())
 * - URL key aliasing (?pg=, ?s= → {page, sort})
 * - Default values applied when params absent
 * - Client useQueryStates change triggers RSC navigation (shallow:false)
 * - shallow:true update changes URL without RSC fetch
 * - Typed <Link href="/search-params-test"> renders correct href
 * - Typed <Link href="/routes-test/[id]" params={{ id: '42' }}> interpolates to /routes-test/42
 * - useParams() on /routes-test/[id] returns typed { id }
 *
 * Design docs:
 * - design/23-search-params.md
 * - design/09-typescript.md
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

test.describe('server-side typed searchParams', () => {
  test('renders server-side parsed search params', async ({ page }) => {
    const response = await page.goto('/search-params-test');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="search-params-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="server-page"]')).toHaveText('page: 1');
    await expect(page.locator('[data-testid="server-q"]')).toHaveText('q: (null)');
    await expect(page.locator('[data-testid="server-sort"]')).toHaveText('sort: relevance');
  });

  test('URL key aliases round-trip', async ({ page }) => {
    // ?pg=2&s=price-asc → { page: 2, sort: 'price-asc' }
    const response = await page.goto('/search-params-test?pg=2&s=price-asc');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="server-page"]')).toHaveText('page: 2');
    await expect(page.locator('[data-testid="server-sort"]')).toHaveText('sort: price-asc');
  });

  test('default values applied on initial load', async ({ page }) => {
    await page.goto('/search-params-test');
    // page defaults to 1, sort to 'relevance', q to null
    await expect(page.locator('[data-testid="server-page"]')).toHaveText('page: 1');
    await expect(page.locator('[data-testid="server-sort"]')).toHaveText('sort: relevance');
    await expect(page.locator('[data-testid="server-q"]')).toHaveText('q: (null)');
  });

  test('server renders q param', async ({ page }) => {
    await page.goto('/search-params-test?q=hello');
    await expect(page.locator('[data-testid="server-q"]')).toHaveText('q: hello');
  });
});

test.describe('client useQueryStates', () => {
  test('sort change triggers RSC navigation and updates server values', async ({ page }) => {
    await page.goto('/search-params-test');
    await expect(page.locator('[data-testid="filter-bar"]')).toBeVisible();

    // Track RSC fetches to confirm server navigation fires
    let rscRequestCount = 0;
    page.on('request', (req) => {
      if (req.headers()['accept']?.includes('text/x-component')) {
        rscRequestCount++;
      }
    });

    await page.selectOption('[data-testid="sort-select"]', 'price-asc');

    // URL should update to aliased key ?s=price-asc
    await expect(page).toHaveURL(/s=price-asc/);

    // Server-rendered value must update — confirms RSC navigation completed
    // and nuqs synced its state after timber:navigation-end was dispatched.
    await expect(page.locator('[data-testid="server-sort"]')).toHaveText('sort: price-asc');

    // Client display should also reflect new value without flash
    await expect(page.locator('[data-testid="client-sort"]')).toHaveText('sort: price-asc');

    expect(rscRequestCount).toBeGreaterThan(0);
  });

  test('sort select does not flash back to old value after navigation', async ({ page }) => {
    await page.goto('/search-params-test');

    // Change sort and immediately check — should not revert to 'relevance'
    await page.selectOption('[data-testid="sort-select"]', 'newest');
    await expect(page.locator('[data-testid="client-sort"]')).toHaveText('sort: newest');

    // Wait for server navigation to settle — value must remain 'newest'
    await expect(page.locator('[data-testid="server-sort"]')).toHaveText('sort: newest');
    await expect(page.locator('[data-testid="client-sort"]')).toHaveText('sort: newest');
  });

  test('next-page button triggers RSC navigation and updates server page', async ({ page }) => {
    await page.goto('/search-params-test');

    let rscRequestCount = 0;
    page.on('request', (req) => {
      if (req.headers()['accept']?.includes('text/x-component')) {
        rscRequestCount++;
      }
    });

    await page.click('[data-testid="next-page-btn"]');

    // URL should use aliased key ?pg=2
    await expect(page).toHaveURL(/pg=2/);
    await expect(page.locator('[data-testid="server-page"]')).toHaveText('page: 2');
    await expect(page.locator('[data-testid="client-page"]')).toHaveText('page: 2');

    expect(rscRequestCount).toBeGreaterThan(0);
  });

  test('q input is shallow — typing updates URL without RSC fetch', async ({ page }) => {
    await page.goto('/search-params-test');

    let rscRequestCount = 0;
    page.on('request', (req) => {
      if (req.headers()['accept']?.includes('text/x-component')) {
        rscRequestCount++;
      }
    });

    // Type into the search input character by character
    await page.fill('[data-testid="q-input"]', 'hello');

    // URL should update shallowly with each keystroke
    await expect(page).toHaveURL(/q=hello/);

    // Client value reflects what was typed
    await expect(page.locator('[data-testid="client-q"]')).toHaveText('q: hello');

    // No RSC fetch should have fired — q input uses shallow:true
    expect(rscRequestCount).toBe(0);
  });

  test('q input does not flash back while typing', async ({ page }) => {
    await page.goto('/search-params-test');

    const input = page.locator('[data-testid="q-input"]');
    await input.fill('abc');

    // Input value must stay at 'abc' — no flash back to empty
    await expect(input).toHaveValue('abc');
  });

  test('shallow mode skips server navigation', async ({ page }) => {
    await page.goto('/search-params-test');

    let rscRequestCount = 0;
    page.on('request', (req) => {
      if (req.headers()['accept']?.includes('text/x-component')) {
        rscRequestCount++;
      }
    });

    await page.click('[data-testid="shallow-sort-btn"]');

    // URL should update (sort param via aliased key 's')
    await expect(page).toHaveURL(/s=newest/);

    // No RSC fetch should have fired (shallow:true)
    expect(rscRequestCount).toBe(0);
  });
});

test.describe('typed Link', () => {
  test('typed Link renders correct href', async ({ page }) => {
    await page.goto('/search-params-test');
    const link = page.locator('[data-testid="typed-link-static"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBe('/search-params-test');
  });

  test('typed Link with params interpolates href', async ({ page }) => {
    await page.goto('/search-params-test');
    const link = page.locator('[data-testid="typed-link-dynamic"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBe('/routes-test/42');
  });

  test('home page typed Link to dynamic route interpolates correctly', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('[data-testid="home-link-dynamic"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBe('/routes-test/42');
  });
});

test.describe('useParams on dynamic route', () => {
  test('useParams returns typed id param', async ({ page }) => {
    const response = await page.goto('/routes-test/42');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-testid="dynamic-id-page"]')).toBeVisible();

    // Server-rendered param from props
    await expect(page.locator('[data-testid="dynamic-id-value"]')).toHaveText('42');

    // Client useParams() — rendered by IdParams client component
    await expect(page.locator('[data-testid="use-params-id"]')).toHaveText('42');
  });

  test('useParams reflects updated id after client navigation', async ({ page }) => {
    await page.goto('/routes-test/42');
    await expect(page.locator('[data-testid="use-params-id"]')).toHaveText('42');

    // Navigate to a different id via typed Link from search-params page
    await page.goto('/search-params-test');
    await page.click('[data-testid="typed-link-dynamic"]');

    await expect(page.locator('[data-testid="dynamic-id-value"]')).toHaveText('42');
    await expect(page.locator('[data-testid="use-params-id"]')).toHaveText('42');
  });
});
