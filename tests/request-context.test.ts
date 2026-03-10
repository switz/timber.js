import { describe, it, expect } from 'vitest';
import {
  headers,
  cookies,
  runWithRequestContext,
} from '../packages/timber-app/src/server/request-context';

// ─── headers() ───────────────────────────────────────────────────

describe('headers()', () => {
  it('throws outside request context', () => {
    expect(() => headers()).toThrow('outside of a request context');
  });

  it('returns request headers within context', () => {
    const req = new Request('http://localhost/test', {
      headers: { 'X-Custom': 'value', 'Content-Type': 'text/html' },
    });

    runWithRequestContext(req, () => {
      const h = headers();
      expect(h.get('x-custom')).toBe('value');
      expect(h.get('content-type')).toBe('text/html');
    });
  });

  it('returns undefined for missing headers', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      const h = headers();
      expect(h.get('x-nonexistent')).toBeNull();
    });
  });

  it('has() works correctly', () => {
    const req = new Request('http://localhost/test', {
      headers: { 'Authorization': 'Bearer token' },
    });

    runWithRequestContext(req, () => {
      const h = headers();
      expect(h.has('authorization')).toBe(true);
      expect(h.has('x-missing')).toBe(false);
    });
  });
});

// ─── cookies() ──────────────────────────────────────────────────

describe('cookies()', () => {
  it('throws outside request context', () => {
    expect(() => cookies()).toThrow('outside of a request context');
  });

  it('parses cookie header', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'session=abc123; theme=dark' },
    });

    runWithRequestContext(req, () => {
      const c = cookies();
      expect(c.get('session')).toBe('abc123');
      expect(c.get('theme')).toBe('dark');
    });
  });

  it('returns undefined for missing cookies', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'session=abc123' },
    });

    runWithRequestContext(req, () => {
      const c = cookies();
      expect(c.get('missing')).toBeUndefined();
    });
  });

  it('has() checks cookie existence', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'session=abc123' },
    });

    runWithRequestContext(req, () => {
      const c = cookies();
      expect(c.has('session')).toBe(true);
      expect(c.has('missing')).toBe(false);
    });
  });

  it('getAll() returns all cookies', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'a=1; b=2; c=3' },
    });

    runWithRequestContext(req, () => {
      const c = cookies();
      const all = c.getAll();
      expect(all).toEqual([
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
        { name: 'c', value: '3' },
      ]);
    });
  });

  it('handles empty cookie header', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      const c = cookies();
      expect(c.getAll()).toEqual([]);
      expect(c.get('anything')).toBeUndefined();
    });
  });

  it('handles cookies with = in value', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'token=abc=def==; other=val' },
    });

    runWithRequestContext(req, () => {
      const c = cookies();
      expect(c.get('token')).toBe('abc=def==');
      expect(c.get('other')).toBe('val');
    });
  });

  it('lazily parses cookies (only on first access)', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'session=abc123' },
    });

    runWithRequestContext(req, () => {
      // First call to headers() should work without parsing cookies
      const h = headers();
      expect(h.get('cookie')).toBe('session=abc123');

      // Now access cookies
      const c = cookies();
      expect(c.get('session')).toBe('abc123');
    });
  });
});

// ─── Cross-request isolation ────────────────────────────────────

describe('cross-request isolation', () => {
  it('each request has its own context', async () => {
    const req1 = new Request('http://localhost/a', {
      headers: { Cookie: 'user=alice' },
    });
    const req2 = new Request('http://localhost/b', {
      headers: { Cookie: 'user=bob' },
    });

    const results: string[] = [];

    await Promise.all([
      new Promise<void>((resolve) => {
        runWithRequestContext(req1, () => {
          results.push(cookies().get('user')!);
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        runWithRequestContext(req2, () => {
          results.push(cookies().get('user')!);
          resolve();
        });
      }),
    ]);

    expect(results).toContain('alice');
    expect(results).toContain('bob');
  });
});
