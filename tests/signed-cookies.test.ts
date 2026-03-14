import { describe, it, expect, afterEach } from 'vitest';
import {
  cookies,
  runWithRequestContext,
  setMutableCookieContext,
  getSetCookieHeaders,
  setCookieSecrets,
} from '../packages/timber-app/src/server/request-context';

// ─── Signed cookies ─────────────────────────────────────────────

describe('signed cookies', () => {
  const SECRET = 'test-secret-key-for-hmac-256';
  const SECRET_NEW = 'new-secret-key-2024';
  const SECRET_OLD = 'old-secret-key-2023';

  afterEach(() => {
    // Reset secrets after each test
    setCookieSecrets([]);
  });

  describe('getSigned()', () => {
    it('returns undefined when no secrets are configured', () => {
      const req = new Request('http://localhost/test', {
        headers: { Cookie: 'prefs=somevalue.somesig' },
      });

      runWithRequestContext(req, () => {
        expect(cookies().getSigned('prefs')).toBeUndefined();
      });
    });

    it('returns undefined for non-existent cookie', () => {
      setCookieSecrets([SECRET]);
      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        expect(cookies().getSigned('missing')).toBeUndefined();
      });
    });

    it('returns undefined for cookie without signature (no dot)', () => {
      setCookieSecrets([SECRET]);
      const req = new Request('http://localhost/test', {
        headers: { Cookie: 'prefs=notsigned' },
      });

      runWithRequestContext(req, () => {
        expect(cookies().getSigned('prefs')).toBeUndefined();
      });
    });

    it('returns undefined for tampered cookie value', () => {
      setCookieSecrets([SECRET]);
      const req = new Request('http://localhost/test', {
        headers: { Cookie: 'prefs=tampered.invalidsignature' },
      });

      runWithRequestContext(req, () => {
        expect(cookies().getSigned('prefs')).toBeUndefined();
      });
    });

    it('verifies and returns value for correctly signed cookie', () => {
      setCookieSecrets([SECRET]);
      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        // Set a signed cookie, then read it back
        cookies().set('prefs', 'hello', { signed: true });

        // getSigned should return the original value
        expect(cookies().getSigned('prefs')).toBe('hello');
      });
    });

    it('supports key rotation — verifies with old secret', () => {
      // First, set a cookie with the old secret
      setCookieSecrets([SECRET_OLD]);
      let signedCookieValue: string | undefined;

      const req1 = new Request('http://localhost/test');
      runWithRequestContext(req1, () => {
        setMutableCookieContext(true);
        cookies().set('token', 'myvalue', { signed: true });
        // Capture the raw cookie value (value.signature)
        signedCookieValue = cookies().get('token');
      });

      // Now rotate secrets — new secret first, old secret still present
      setCookieSecrets([SECRET_NEW, SECRET_OLD]);

      // Simulate a new request with the old-secret-signed cookie
      const req2 = new Request('http://localhost/test', {
        headers: { Cookie: `token=${signedCookieValue}` },
      });

      runWithRequestContext(req2, () => {
        // Should still verify because SECRET_OLD is in the array
        expect(cookies().getSigned('token')).toBe('myvalue');
      });
    });

    it('returns undefined when secret is rotated out', () => {
      // Set a cookie with the old secret
      setCookieSecrets([SECRET_OLD]);
      let signedCookieValue: string | undefined;

      const req1 = new Request('http://localhost/test');
      runWithRequestContext(req1, () => {
        setMutableCookieContext(true);
        cookies().set('token', 'myvalue', { signed: true });
        signedCookieValue = cookies().get('token');
      });

      // Remove old secret entirely
      setCookieSecrets([SECRET_NEW]);

      const req2 = new Request('http://localhost/test', {
        headers: { Cookie: `token=${signedCookieValue}` },
      });

      runWithRequestContext(req2, () => {
        expect(cookies().getSigned('token')).toBeUndefined();
      });
    });

    it('never throws on invalid input', () => {
      setCookieSecrets([SECRET]);

      const cases = [
        'prefs=',           // empty value
        'prefs=.',          // dot only
        'prefs=.signature', // empty value part
        'prefs=value.',     // empty signature part
        'prefs=a.b.c.d',   // multiple dots — split at last dot
      ];

      for (const cookieStr of cases) {
        const req = new Request('http://localhost/test', {
          headers: { Cookie: cookieStr },
        });

        runWithRequestContext(req, () => {
          // Should return undefined, never throw
          expect(cookies().getSigned('prefs')).toBeUndefined();
        });
      }
    });
  });

  describe('set() with signed option', () => {
    it('signs the cookie value with HMAC-SHA256', () => {
      setCookieSecrets([SECRET]);
      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        cookies().set('prefs', 'hello', { signed: true });

        // The raw value should be value.signature format
        const raw = cookies().get('prefs');
        expect(raw).toBeDefined();
        expect(raw).toContain('.');
        const parts = raw!.split('.');
        // Last part is hex signature (64 chars for SHA-256)
        expect(parts[parts.length - 1]).toMatch(/^[a-f0-9]{64}$/);
      });
    });

    it('signs with the first secret in the array (newest)', () => {
      setCookieSecrets([SECRET_NEW, SECRET_OLD]);
      const req = new Request('http://localhost/test');

      let signedValue1: string | undefined;
      let signedValue2: string | undefined;

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        cookies().set('a', 'val', { signed: true });
        signedValue1 = cookies().get('a');
      });

      // Set with just SECRET_NEW — should produce same signature
      setCookieSecrets([SECRET_NEW]);
      const req2 = new Request('http://localhost/test');
      runWithRequestContext(req2, () => {
        setMutableCookieContext(true);
        cookies().set('a', 'val', { signed: true });
        signedValue2 = cookies().get('a');
      });

      expect(signedValue1).toBe(signedValue2);
    });

    it('throws when signed: true but no secrets configured', () => {
      setCookieSecrets([]);
      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        expect(() => cookies().set('prefs', 'val', { signed: true })).toThrow(
          'cookies.secret'
        );
      });
    });

    it('produces Set-Cookie header with signed value', () => {
      setCookieSecrets([SECRET]);
      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        cookies().set('prefs', 'hello', { signed: true });

        const headers = getSetCookieHeaders();
        expect(headers).toHaveLength(1);
        // The Set-Cookie header should contain the signed value
        expect(headers[0]).toMatch(/prefs=hello\.[a-f0-9]{64}/);
        expect(headers[0]).toContain('HttpOnly');
      });
    });

    it('handles values containing dots correctly', () => {
      setCookieSecrets([SECRET]);
      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        // Value with dots — signature is at the LAST dot
        cookies().set('data', 'a.b.c', { signed: true });

        const signed = cookies().getSigned('data');
        expect(signed).toBe('a.b.c');
      });
    });
  });

  describe('round-trip: set signed then getSigned in same request', () => {
    it('read-your-own-writes works with signed cookies', () => {
      setCookieSecrets([SECRET]);
      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        cookies().set('session', 'user123', { signed: true });

        // getSigned should work on cookies set in the same request
        expect(cookies().getSigned('session')).toBe('user123');
      });
    });
  });

  describe('round-trip: set in one request, verify in another', () => {
    it('cross-request signed cookie verification', () => {
      setCookieSecrets([SECRET]);

      // Request 1: Set the cookie
      let setCookieHeader: string;
      const req1 = new Request('http://localhost/test');
      runWithRequestContext(req1, () => {
        setMutableCookieContext(true);
        cookies().set('token', 'abc123', { signed: true });
        setCookieHeader = getSetCookieHeaders()[0];
      });

      // Extract the cookie value from Set-Cookie header
      const match = setCookieHeader!.match(/^token=([^;]+)/);
      expect(match).toBeTruthy();
      const cookieValue = match![1];

      // Request 2: Verify the cookie
      const req2 = new Request('http://localhost/test', {
        headers: { Cookie: `token=${cookieValue}` },
      });
      runWithRequestContext(req2, () => {
        expect(cookies().getSigned('token')).toBe('abc123');
      });
    });
  });
});
