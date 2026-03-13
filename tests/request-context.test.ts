import { describe, it, expect } from 'vitest';
import {
  headers,
  cookies,
  runWithRequestContext,
  setMutableCookieContext,
  markResponseFlushed,
  getSetCookieHeaders,
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
      headers: { Authorization: 'Bearer token' },
    });

    runWithRequestContext(req, () => {
      const h = headers();
      expect(h.has('authorization')).toBe(true);
      expect(h.has('x-missing')).toBe(false);
    });
  });

  it('rejects .set() mutation at runtime', () => {
    const req = new Request('http://localhost/test', {
      headers: { 'X-Custom': 'value' },
    });

    runWithRequestContext(req, () => {
      const h = headers() as Headers;
      expect(() => h.set('X-Evil', 'injected')).toThrow('read-only');
    });
  });

  it('rejects .append() mutation at runtime', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      const h = headers() as Headers;
      expect(() => h.append('X-Evil', 'injected')).toThrow('read-only');
    });
  });

  it('rejects .delete() mutation at runtime', () => {
    const req = new Request('http://localhost/test', {
      headers: { Authorization: 'Bearer token' },
    });

    runWithRequestContext(req, () => {
      const h = headers() as Headers;
      expect(() => h.delete('Authorization')).toThrow('read-only');
    });
  });

  it('mutations do not affect original request headers', () => {
    const req = new Request('http://localhost/test', {
      headers: { 'X-Original': 'value' },
    });

    runWithRequestContext(req, () => {
      // The store holds a copy, so the original request is never affected
      expect(req.headers.get('X-Original')).toBe('value');
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

// ─── cookies() mutation ─────────────────────────────────────────

describe('cookies() mutation', () => {
  it('throws when set() is called in a read-only context', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      expect(() => cookies().set('foo', 'bar')).toThrow(
        'cookies().set() cannot be called in this context'
      );
    });
  });

  it('throws when delete() is called in a read-only context', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      expect(() => cookies().delete('foo')).toThrow(
        'cookies().delete() cannot be called in this context'
      );
    });
  });

  it('allows set() in mutable context', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      setMutableCookieContext(true);
      cookies().set('theme', 'dark');
      expect(cookies().get('theme')).toBe('dark');
    });
  });

  it('supports read-your-own-writes', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'session=old-token' },
    });

    runWithRequestContext(req, () => {
      setMutableCookieContext(true);
      expect(cookies().get('session')).toBe('old-token');

      cookies().set('session', 'new-token');
      expect(cookies().get('session')).toBe('new-token');
    });
  });

  it('delete() removes the cookie from the read view', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'session=abc123' },
    });

    runWithRequestContext(req, () => {
      setMutableCookieContext(true);
      expect(cookies().has('session')).toBe(true);

      cookies().delete('session');
      expect(cookies().has('session')).toBe(false);
      expect(cookies().get('session')).toBeUndefined();
    });
  });

  it('clear() removes all cookies from the read view', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'a=1; b=2; c=3' },
    });

    runWithRequestContext(req, () => {
      setMutableCookieContext(true);
      expect(cookies().size).toBe(3);

      cookies().clear();
      expect(cookies().size).toBe(0);
      expect(cookies().getAll()).toEqual([]);
    });
  });

  it('size returns the number of cookies', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'a=1; b=2' },
    });

    runWithRequestContext(req, () => {
      expect(cookies().size).toBe(2);

      setMutableCookieContext(true);
      cookies().set('c', '3');
      expect(cookies().size).toBe(3);
    });
  });

  it('toString() serializes cookies', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'a=1; b=2' },
    });

    runWithRequestContext(req, () => {
      expect(cookies().toString()).toBe('a=1; b=2');
    });
  });

  it('getSetCookieHeaders() returns serialized Set-Cookie headers', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      setMutableCookieContext(true);
      cookies().set('theme', 'dark', { httpOnly: false, secure: false });
      cookies().set('session', 'abc', { maxAge: 3600 });

      const headers = getSetCookieHeaders();
      expect(headers).toHaveLength(2);
      expect(headers[0]).toContain('theme=dark');
      expect(headers[0]).toContain('Path=/');
      expect(headers[0]).not.toContain('HttpOnly');
      expect(headers[1]).toContain('session=abc');
      expect(headers[1]).toContain('HttpOnly');
      expect(headers[1]).toContain('Secure');
      expect(headers[1]).toContain('SameSite=Lax');
      expect(headers[1]).toContain('Max-Age=3600');
    });
  });

  it('delete() generates a Set-Cookie with Max-Age=0', () => {
    const req = new Request('http://localhost/test', {
      headers: { Cookie: 'session=abc' },
    });

    runWithRequestContext(req, () => {
      setMutableCookieContext(true);
      cookies().delete('session');

      const headers = getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('session=');
      expect(headers[0]).toContain('Max-Age=0');
    });
  });

  it('last write wins for same cookie name', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      setMutableCookieContext(true);
      cookies().set('theme', 'light');
      cookies().set('theme', 'dark');

      const headers = getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('theme=dark');
    });
  });

  it('silently ignores mutations after flush in production', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      setMutableCookieContext(true);
      markResponseFlushed();

      // Should not throw — just silently ignored
      cookies().set('too-late', 'value');
      const headers = getSetCookieHeaders();
      expect(headers).toHaveLength(0);
    });
  });

  it('set() applies secure defaults', () => {
    const req = new Request('http://localhost/test');

    runWithRequestContext(req, () => {
      setMutableCookieContext(true);
      cookies().set('s', 'val');

      const headers = getSetCookieHeaders();
      expect(headers[0]).toContain('Path=/');
      expect(headers[0]).toContain('HttpOnly');
      expect(headers[0]).toContain('Secure');
      expect(headers[0]).toContain('SameSite=Lax');
    });
  });
});
