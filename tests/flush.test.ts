import { describe, it, expect, vi } from 'vitest';
import { flushResponse, type RenderFn } from '../packages/timber-app/src/server/flush';
import {
  DenySignal,
  RedirectSignal,
  RenderError,
} from '../packages/timber-app/src/server/primitives';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a render function that succeeds with a simple stream. */
function successRender(body = '<html>OK</html>'): RenderFn {
  return () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    });
    return {
      stream,
      shellReady: Promise.resolve(),
    };
  };
}

/** Create a render function where shellReady rejects with the given error. */
function shellRejectRender(error: unknown): RenderFn {
  return () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    return {
      stream,
      shellReady: Promise.reject(error),
    };
  };
}

/** Create a render function that throws synchronously. */
function throwRender(error: unknown): RenderFn {
  return () => {
    throw error;
  };
}

// ─── Holds Until Shell Ready ──────────────────────────────────────────────────

describe('holds until shell ready', () => {
  it('returns response only after shellReady resolves', async () => {
    let resolveShell: () => void;
    const shellReady = new Promise<void>((resolve) => {
      resolveShell = resolve;
    });

    const renderFn: RenderFn = () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>OK</html>'));
          controller.close();
        },
      });
      return { stream, shellReady };
    };

    let resolved = false;
    const promise = flushResponse(renderFn).then((result) => {
      resolved = true;
      return result;
    });

    // Before shell ready, promise should not resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Resolve shell
    resolveShell!();
    const result = await promise;
    expect(resolved).toBe(true);
    expect(result.status).toBe(200);
  });

  it('returns 200 with HTML content-type on success', async () => {
    const result = await flushResponse(successRender());
    expect(result.status).toBe(200);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(result.isRedirect).toBe(false);
    expect(result.isDenial).toBe(false);
  });

  it('streams the HTML body', async () => {
    const body = '<html><body>Hello timber!</body></html>';
    const result = await flushResponse(successRender(body));
    const text = await result.response.text();
    expect(text).toBe(body);
  });
});

// ─── Deny Before Flush ────────────────────────────────────────────────────────

describe('deny before flush', () => {
  it('DenySignal during shell → correct HTTP 403', async () => {
    const result = await flushResponse(shellRejectRender(new DenySignal(403)));
    expect(result.status).toBe(403);
    expect(result.response.status).toBe(403);
    expect(result.isDenial).toBe(true);
    expect(result.isRedirect).toBe(false);
  });

  it('DenySignal with 404 → HTTP 404', async () => {
    const result = await flushResponse(shellRejectRender(new DenySignal(404)));
    expect(result.status).toBe(404);
    expect(result.isDenial).toBe(true);
  });

  it('DenySignal with 401 → HTTP 401', async () => {
    const result = await flushResponse(shellRejectRender(new DenySignal(401)));
    expect(result.status).toBe(401);
    expect(result.isDenial).toBe(true);
  });

  it('DenySignal with 429 → HTTP 429', async () => {
    const result = await flushResponse(shellRejectRender(new DenySignal(429)));
    expect(result.status).toBe(429);
    expect(result.isDenial).toBe(true);
  });

  it('DenySignal thrown synchronously during render start', async () => {
    const result = await flushResponse(throwRender(new DenySignal(403)));
    expect(result.status).toBe(403);
    expect(result.isDenial).toBe(true);
  });
});

// ─── Redirect Before Flush ────────────────────────────────────────────────────

describe('redirect before flush', () => {
  it('RedirectSignal during shell → HTTP 302 with Location', async () => {
    const result = await flushResponse(shellRejectRender(new RedirectSignal('/login', 302)));
    expect(result.status).toBe(302);
    expect(result.response.status).toBe(302);
    expect(result.response.headers.get('Location')).toBe('/login');
    expect(result.isRedirect).toBe(true);
    expect(result.isDenial).toBe(false);
  });

  it('RedirectSignal with 301 → HTTP 301', async () => {
    const result = await flushResponse(shellRejectRender(new RedirectSignal('/new-path', 301)));
    expect(result.status).toBe(301);
    expect(result.response.headers.get('Location')).toBe('/new-path');
    expect(result.isRedirect).toBe(true);
  });

  it('RedirectSignal with query params preserved', async () => {
    const result = await flushResponse(
      shellRejectRender(new RedirectSignal('/login?returnTo=/dashboard', 302))
    );
    expect(result.response.headers.get('Location')).toBe('/login?returnTo=/dashboard');
  });

  it('RedirectSignal thrown synchronously during render start', async () => {
    const result = await flushResponse(throwRender(new RedirectSignal('/login', 302)));
    expect(result.status).toBe(302);
    expect(result.isRedirect).toBe(true);
  });
});

// ─── Throw Before Flush ──────────────────────────────────────────────────────

describe('throw before flush', () => {
  it('unhandled error during shell → HTTP 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushResponse(shellRejectRender(new Error('render crash')));
    expect(result.status).toBe(500);
    expect(result.response.status).toBe(500);
    expect(result.isRedirect).toBe(false);
    expect(result.isDenial).toBe(false);

    errorSpy.mockRestore();
  });

  it('RenderError during shell → HTTP status from error', async () => {
    const result = await flushResponse(
      shellRejectRender(new RenderError('NOT_FOUND', { id: '42' }, { status: 404 }))
    );
    expect(result.status).toBe(404);
    expect(result.isDenial).toBe(false);
  });

  it('RenderError with default status → HTTP 500', async () => {
    const result = await flushResponse(
      shellRejectRender(new RenderError('CRASH', { detail: 'oops' }))
    );
    expect(result.status).toBe(500);
  });

  it('unhandled error thrown synchronously during render start', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushResponse(throwRender(new Error('sync crash')));
    expect(result.status).toBe(500);

    errorSpy.mockRestore();
  });

  it('non-Error throw during shell → HTTP 500', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushResponse(shellRejectRender('string error'));
    expect(result.status).toBe(500);

    errorSpy.mockRestore();
  });
});

// ─── Response Headers ─────────────────────────────────────────────────────────

describe('response headers', () => {
  it('includes responseHeaders from options on success', async () => {
    const headers = new Headers({ 'X-Custom': 'value' });
    const result = await flushResponse(successRender(), { responseHeaders: headers });

    expect(result.response.headers.get('X-Custom')).toBe('value');
    expect(result.response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('includes responseHeaders on redirect', async () => {
    const headers = new Headers({ 'X-Request-Id': 'abc' });
    const result = await flushResponse(shellRejectRender(new RedirectSignal('/login', 302)), {
      responseHeaders: headers,
    });

    expect(result.response.headers.get('X-Request-Id')).toBe('abc');
    expect(result.response.headers.get('Location')).toBe('/login');
  });

  it('includes responseHeaders on denial', async () => {
    const headers = new Headers({ 'X-Request-Id': 'abc' });
    const result = await flushResponse(shellRejectRender(new DenySignal(403)), {
      responseHeaders: headers,
    });

    expect(result.response.headers.get('X-Request-Id')).toBe('abc');
  });

  it('uses custom defaultStatus', async () => {
    const result = await flushResponse(successRender(), { defaultStatus: 201 });
    expect(result.status).toBe(201);
    expect(result.response.status).toBe(201);
  });
});
