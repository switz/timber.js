/**
 * E2E tests for route.ts API endpoints.
 *
 * Validates:
 * - GET route returns JSON with query params
 * - POST route receives and echoes JSON body
 * - Unsupported method returns 405 with Allow header
 *
 * Design docs: design/07-routing.md §route.ts
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

test.describe('API route: echo', () => {
  test('GET route returns JSON', async ({ request }) => {
    const response = await request.get('/api/echo?foo=bar&baz=qux');
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      method: 'GET',
      query: { foo: 'bar', baz: 'qux' },
    });
  });

  test('POST route receives body', async ({ request }) => {
    const response = await request.post('/api/echo', {
      data: { message: 'hello', count: 42 },
    });
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      method: 'POST',
      body: { message: 'hello', count: 42 },
    });
  });
});

test.describe('API route: method restriction', () => {
  test('unsupported method returns 405', async ({ request }) => {
    const response = await request.post('/api/methods', {
      data: { test: true },
    });
    expect(response.status()).toBe(405);
    const allow = response.headers()['allow'];
    expect(allow).toContain('GET');
  });
});
