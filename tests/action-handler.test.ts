/**
 * Tests for action-handler.ts — verifies body limits, CSRF, and dispatch wiring.
 *
 * Mocks @vitejs/plugin-rsc/rsc to isolate the handler from the RSC runtime.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the RSC runtime — we're testing the handler dispatch logic, not RSC serialization.
vi.mock('@vitejs/plugin-rsc/rsc', () => ({
  loadServerAction: vi.fn(async () => async () => ({ ok: true })),
  decodeReply: vi.fn(async (body: unknown) => [body]),
  decodeAction: vi.fn(async () => async () => ({ ok: true })),
  renderToReadableStream: vi.fn(
    (value: unknown) =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
          controller.close();
        },
      })
  ),
}));

// Mock request-context — no ALS needed for these tests.
vi.mock('../packages/timber-app/src/server/request-context', () => ({
  runWithRequestContext: vi.fn(async (_req: Request, fn: () => Promise<unknown>) => fn()),
}));

// Mock executeAction to avoid revalidation ALS setup.
vi.mock('../packages/timber-app/src/server/actions', () => ({
  executeAction: vi.fn(async (fn: (...args: unknown[]) => Promise<unknown>, args: unknown[]) => {
    const result = await fn(...args);
    return { actionResult: result };
  }),
}));

import {
  handleActionRequest,
  isActionRequest,
  type ActionDispatchConfig,
} from '../packages/timber-app/src/server/action-handler';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeActionRequest(
  opts: {
    contentLength?: string;
    contentType?: string;
    actionId?: string;
    origin?: string;
    host?: string;
    body?: string;
  } = {}
): Request {
  const headers: Record<string, string> = {
    Host: opts.host ?? 'localhost',
    Origin: opts.origin ?? 'http://localhost',
  };
  if (opts.actionId) headers['x-rsc-action'] = opts.actionId;
  if (opts.contentType) headers['Content-Type'] = opts.contentType;
  if (opts.contentLength) headers['Content-Length'] = opts.contentLength;

  return new Request('http://localhost/action', {
    method: 'POST',
    headers,
    body: opts.body ?? 'test',
  });
}

const defaultConfig: ActionDispatchConfig = {
  csrf: {},
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('handleActionRequest — body limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows action request within default limit (1MB)', async () => {
    const req = makeActionRequest({
      actionId: 'file#action',
      contentLength: String(500_000), // 500KB — under 1MB
    });

    const res = await handleActionRequest(req, defaultConfig);
    expect(res).not.toBeNull();
    expect(res!.status).not.toBe(413);
  });

  it('returns 413 for action request exceeding default limit', async () => {
    const req = makeActionRequest({
      actionId: 'file#action',
      contentLength: String(2_000_000), // 2MB — over 1MB default
    });

    const res = await handleActionRequest(req, defaultConfig);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(413);
  });

  it('returns 413 for upload exceeding default upload limit (10MB)', async () => {
    const req = makeActionRequest({
      actionId: 'file#action',
      contentType: 'multipart/form-data; boundary=----formdata',
      contentLength: String(20_000_000), // 20MB — over 10MB default
    });

    const res = await handleActionRequest(req, defaultConfig);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(413);
  });

  it('allows upload within default upload limit (10MB)', async () => {
    const req = makeActionRequest({
      actionId: 'file#action',
      contentType: 'multipart/form-data; boundary=----formdata',
      contentLength: String(5_000_000), // 5MB — under 10MB
    });

    // The request passes body limits but may fail at FormData parsing
    // since we're not providing real multipart data. What matters is
    // it doesn't return 413.
    try {
      const res = await handleActionRequest(req, defaultConfig);
      expect(res).not.toBeNull();
      expect(res!.status).not.toBe(413);
    } catch (e) {
      // FormData parse error is expected — the body limit check passed
      expect((e as Error).message).toMatch(/FormData/i);
    }
  });

  it('respects custom limits from config', async () => {
    const config: ActionDispatchConfig = {
      csrf: {},
      bodyLimits: {
        limits: {
          actionBodySize: '512kb',
        },
      },
    };

    // Under custom limit
    const reqOk = makeActionRequest({
      actionId: 'file#action',
      contentLength: String(400_000), // ~390KB
    });
    const resOk = await handleActionRequest(reqOk, config);
    expect(resOk).not.toBeNull();
    expect(resOk!.status).not.toBe(413);

    // Over custom limit
    const reqBig = makeActionRequest({
      actionId: 'file#action',
      contentLength: String(600_000), // ~585KB — over 512KB
    });
    const resBig = await handleActionRequest(reqBig, config);
    expect(resBig).not.toBeNull();
    expect(resBig!.status).toBe(413);
  });

  it('body limits run after CSRF (CSRF rejects first)', async () => {
    // Cross-origin request that also exceeds body limits —
    // should get 403 (CSRF), not 413 (body limits).
    const req = makeActionRequest({
      actionId: 'file#action',
      origin: 'https://evil.com',
      host: 'example.com',
      contentLength: String(2_000_000),
    });

    const res = await handleActionRequest(req, defaultConfig);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('body limits run before action execution', async () => {
    const { executeAction } = await import('../packages/timber-app/src/server/actions');

    const req = makeActionRequest({
      actionId: 'file#action',
      contentLength: String(2_000_000), // Over limit
    });

    const res = await handleActionRequest(req, defaultConfig);
    expect(res!.status).toBe(413);

    // executeAction should NOT have been called
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('no Content-Length header — allows request (no limit to enforce)', async () => {
    const headers: Record<string, string> = {
      Host: 'localhost',
      Origin: 'http://localhost',
      'x-rsc-action': 'file#action',
    };
    const req = new Request('http://localhost/action', {
      method: 'POST',
      headers,
      body: 'test',
    });

    const res = await handleActionRequest(req, defaultConfig);
    expect(res).not.toBeNull();
    expect(res!.status).not.toBe(413);
  });
});

// ─── Piggybacked Revalidation Tests ──────────────────────────────────────

describe('handleActionRequest — piggybacked revalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets X-Timber-Revalidation header when revalidation is present', async () => {
    const { executeAction } = await import('../packages/timber-app/src/server/actions');
    (executeAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      actionResult: { ok: true },
      revalidation: {
        element: { type: 'div', props: { children: 'Revalidated' } },
        headElements: [],
      },
    });

    const req = makeActionRequest({ actionId: 'file#action' });
    const res = await handleActionRequest(req, defaultConfig);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get('X-Timber-Revalidation')).toBe('1');
  });

  it('serializes wrapper object { _action, _tree } when revalidation is present', async () => {
    const { renderToReadableStream } = await import('@vitejs/plugin-rsc/rsc');
    const { executeAction } = await import('../packages/timber-app/src/server/actions');

    const mockElement = { type: 'div', props: { children: 'Fresh' } };
    (executeAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      actionResult: { saved: true },
      revalidation: {
        element: mockElement,
        headElements: [],
      },
    });

    const req = makeActionRequest({ actionId: 'file#action' });
    await handleActionRequest(req, defaultConfig);

    // renderToReadableStream should have been called with the wrapper object
    expect(renderToReadableStream).toHaveBeenCalledWith({
      _action: { saved: true },
      _tree: mockElement,
    });
  });

  it('does not set X-Timber-Revalidation header when no revalidation', async () => {
    const req = makeActionRequest({ actionId: 'file#action' });
    const res = await handleActionRequest(req, defaultConfig);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get('X-Timber-Revalidation')).toBeNull();
  });

  it('forwards head elements as X-Timber-Head header', async () => {
    const { executeAction } = await import('../packages/timber-app/src/server/actions');
    const headElements = [
      { tag: 'title', content: 'Updated Page' },
      { tag: 'meta', attrs: { name: 'description', content: 'Fresh content' } },
    ];
    (executeAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      actionResult: { ok: true },
      revalidation: {
        element: { type: 'div' },
        headElements,
      },
    });

    const req = makeActionRequest({ actionId: 'file#action' });
    const res = await handleActionRequest(req, defaultConfig);

    expect(res!.headers.get('X-Timber-Head')).toBe(JSON.stringify(headElements));
  });

  it('omits X-Timber-Head when headElements is empty', async () => {
    const { executeAction } = await import('../packages/timber-app/src/server/actions');
    (executeAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      actionResult: { ok: true },
      revalidation: {
        element: { type: 'div' },
        headElements: [],
      },
    });

    const req = makeActionRequest({ actionId: 'file#action' });
    const res = await handleActionRequest(req, defaultConfig);

    expect(res!.headers.get('X-Timber-Head')).toBeNull();
  });

  it('error actions never include revalidation', async () => {
    const { executeAction } = await import('../packages/timber-app/src/server/actions');
    (executeAction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    const req = makeActionRequest({ actionId: 'file#action' });
    const res = await handleActionRequest(req, defaultConfig);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200); // Error responses are 200 with structured error
    expect(res!.headers.get('X-Timber-Revalidation')).toBeNull();
  });
});

describe('isActionRequest', () => {
  it('detects POST with x-rsc-action header', () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'x-rsc-action': 'file#fn' },
    });
    expect(isActionRequest(req)).toBe(true);
  });

  it('detects POST with form content type', () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(isActionRequest(req)).toBe(true);
  });

  it('rejects GET requests', () => {
    const req = new Request('http://localhost/', { method: 'GET' });
    expect(isActionRequest(req)).toBe(false);
  });
});
