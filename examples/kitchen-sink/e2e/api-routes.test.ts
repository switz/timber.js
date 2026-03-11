/**
 * E2E tests for route.ts API endpoints.
 *
 * Covers the full pipeline: proxy → match → middleware → route handler.
 * Validates method dispatch, 405, auto OPTIONS, HEAD fallback, streaming SSE,
 * dynamic params, and error handling.
 *
 * Design docs: design/07-routing.md §"route.ts — API Endpoints"
 *
 * Run: pnpm run test:e2e:kitchen-sink
 */
import { test, expect } from '@playwright/test';

// ─── Echo route (GET + POST) ─────────────────────────────────────────────

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

// ─── Method restriction (GET only) ───────────────────────────────────────

test.describe('API route: method restriction', () => {
  test('unsupported method returns 405', async ({ request }) => {
    const response = await request.post('/api/methods', {
      data: { test: true },
    });
    expect(response.status()).toBe(405);
    const allow = response.headers()['allow'];
    expect(allow).toContain('GET');
    expect(allow).toContain('HEAD');
    expect(allow).toContain('OPTIONS');
  });

  test('405 for PUT on GET-only route', async ({ request }) => {
    const response = await request.put('/api/methods', {
      data: { test: true },
    });
    expect(response.status()).toBe(405);
  });

  test('405 for PATCH on GET-only route', async ({ request }) => {
    const response = await request.patch('/api/methods', {
      data: { test: true },
    });
    expect(response.status()).toBe(405);
  });

  test('405 for DELETE on GET-only route', async ({ request }) => {
    const response = await request.delete('/api/methods');
    expect(response.status()).toBe(405);
  });
});

// ─── Dynamic params (users/[id]) ─────────────────────────────────────────

test.describe('API route: dynamic params', () => {
  test('dynamic param extracted from URL', async ({ request }) => {
    const response = await request.get('/api/users/42');
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ id: '42', name: 'User 42' });
  });

  test('dynamic param with string value', async ({ request }) => {
    const response = await request.get('/api/users/abc-123');
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.id).toBe('abc-123');
  });

  test('PUT dispatches correctly with dynamic param', async ({ request }) => {
    const response = await request.put('/api/users/7', {
      data: { name: 'Updated' },
    });
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ id: '7', name: 'Updated' });
  });

  test('PATCH dispatches correctly with dynamic param', async ({ request }) => {
    const response = await request.patch('/api/users/7', {
      data: { email: 'new@example.com' },
    });
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.id).toBe('7');
    expect(json.patched).toBe(true);
    expect(json.email).toBe('new@example.com');
  });

  test('DELETE returns 204', async ({ request }) => {
    const response = await request.delete('/api/users/99');
    expect(response.status()).toBe(204);
  });
});

// ─── HEAD fallback ───────────────────────────────────────────────────────

test.describe('API route: HEAD fallback', () => {
  test('HEAD fallback uses GET handler, strips body', async ({ request }) => {
    const response = await request.head('/api/echo');
    expect(response.status()).toBe(200);
    // HEAD should have no body
    const text = await response.text();
    expect(text).toBe('');
  });

  test('HEAD on dynamic route returns correct status', async ({ request }) => {
    const response = await request.head('/api/users/42');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toBe('');
  });
});

// ─── Auto OPTIONS ────────────────────────────────────────────────────────

test.describe('API route: OPTIONS auto-response', () => {
  test('OPTIONS returns Allow header', async ({ request }) => {
    const response = await request.fetch('/api/echo', { method: 'OPTIONS' });
    expect(response.status()).toBe(204);
    const allow = response.headers()['allow'];
    expect(allow).toContain('GET');
    expect(allow).toContain('POST');
    expect(allow).toContain('HEAD');
    expect(allow).toContain('OPTIONS');
  });

  test('OPTIONS on GET-only route lists GET, HEAD, OPTIONS', async ({ request }) => {
    const response = await request.fetch('/api/methods', { method: 'OPTIONS' });
    expect(response.status()).toBe(204);
    const allow = response.headers()['allow'];
    expect(allow).toContain('GET');
    expect(allow).toContain('HEAD');
    expect(allow).toContain('OPTIONS');
    expect(allow).not.toContain('POST');
    expect(allow).not.toContain('DELETE');
  });

  test('OPTIONS on users/[id] route lists all methods', async ({ request }) => {
    const response = await request.fetch('/api/users/1', { method: 'OPTIONS' });
    expect(response.status()).toBe(204);
    const allow = response.headers()['allow'];
    expect(allow).toContain('GET');
    expect(allow).toContain('PUT');
    expect(allow).toContain('PATCH');
    expect(allow).toContain('DELETE');
    expect(allow).toContain('HEAD');
    expect(allow).toContain('OPTIONS');
  });
});

// ─── Streaming SSE ───────────────────────────────────────────────────────

test.describe('API route: streaming SSE', () => {
  test('GET returns streaming SSE events', async ({ request }) => {
    const response = await request.get('/api/stream');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/event-stream');

    const text = await response.text();
    // Should contain 3 SSE events
    const events = text.split('\n\n').filter((e) => e.startsWith('data:'));
    expect(events).toHaveLength(3);
    expect(JSON.parse(events[0].replace('data: ', ''))).toEqual({ n: 1 });
    expect(JSON.parse(events[2].replace('data: ', ''))).toEqual({ n: 3 });
  });
});

// ─── Error handling ──────────────────────────────────────────────────────

test.describe('API route: error handling', () => {
  test('handler error returns 500', async ({ request }) => {
    const response = await request.get('/api/error');
    expect(response.status()).toBe(500);
    // Bare 500 — no body leaked
    const text = await response.text();
    expect(text).toBe('');
  });
});
