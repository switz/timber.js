import { describe, it, expect, afterEach } from 'vitest';
import {
  runWithRequestContext,
  setMutableCookieContext,
  getSetCookieHeaders,
  setCookieSecrets,
} from '../packages/timber-app/src/server/request-context';
import { defineCookie } from '../packages/timber-app/src/cookies/define-cookie';
import type { CookieCodec } from '../packages/timber-app/src/cookies/define-cookie';

// ─── Test Codecs ─────────────────────────────────────────────────

/** Simple string codec (passthrough). */
const stringCodec: CookieCodec<string> = {
  parse(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return value[value.length - 1] ?? '';
    return value ?? '';
  },
  serialize(value) {
    return value || null;
  },
};

/** Enum codec with default. */
const themeCodec: CookieCodec<'light' | 'dark' | 'system'> = {
  parse(value) {
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    return 'system';
  },
  serialize(value) {
    return value;
  },
};

/** JSON object codec. */
interface Prefs {
  lang: string;
  fontSize: number;
}
const prefsCodec: CookieCodec<Prefs> = {
  parse(value) {
    if (!value || typeof value !== 'string') return { lang: 'en', fontSize: 16 };
    try {
      const obj = JSON.parse(value);
      return {
        lang: typeof obj.lang === 'string' ? obj.lang : 'en',
        fontSize: typeof obj.fontSize === 'number' ? obj.fontSize : 16,
      };
    } catch {
      return { lang: 'en', fontSize: 16 };
    }
  },
  serialize(value) {
    return JSON.stringify(value);
  },
};

// ─── defineCookie ────────────────────────────────────────────────

describe('defineCookie', () => {
  describe('.get()', () => {
    it('returns parsed value from incoming cookie', () => {
      const theme = defineCookie('theme', { codec: themeCodec, httpOnly: false });

      const req = new Request('http://localhost/test', {
        headers: { Cookie: 'theme=dark' },
      });

      runWithRequestContext(req, () => {
        expect(theme.get()).toBe('dark');
      });
    });

    it('returns default when cookie is missing', () => {
      const theme = defineCookie('theme', { codec: themeCodec });

      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        expect(theme.get()).toBe('system');
      });
    });

    it('returns default when cookie value is invalid', () => {
      const theme = defineCookie('theme', { codec: themeCodec });

      const req = new Request('http://localhost/test', {
        headers: { Cookie: 'theme=invalid' },
      });

      runWithRequestContext(req, () => {
        expect(theme.get()).toBe('system');
      });
    });

    it('parses JSON object cookies', () => {
      const prefs = defineCookie('prefs', { codec: prefsCodec, httpOnly: false });

      const req = new Request('http://localhost/test', {
        headers: { Cookie: 'prefs={"lang":"fr","fontSize":18}' },
      });

      runWithRequestContext(req, () => {
        expect(prefs.get()).toEqual({ lang: 'fr', fontSize: 18 });
      });
    });

    it('returns default for malformed JSON', () => {
      const prefs = defineCookie('prefs', { codec: prefsCodec });

      const req = new Request('http://localhost/test', {
        headers: { Cookie: 'prefs=notjson' },
      });

      runWithRequestContext(req, () => {
        expect(prefs.get()).toEqual({ lang: 'en', fontSize: 16 });
      });
    });
  });

  describe('.set()', () => {
    it('sets a typed value using the codec', () => {
      const theme = defineCookie('theme', { codec: themeCodec, httpOnly: false });

      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        theme.set('dark');

        const headers = getSetCookieHeaders();
        expect(headers).toHaveLength(1);
        expect(headers[0]).toContain('theme=dark');
      });
    });

    it('serializes JSON object values', () => {
      const prefs = defineCookie('prefs', { codec: prefsCodec, httpOnly: false });

      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        prefs.set({ lang: 'fr', fontSize: 18 });

        const headers = getSetCookieHeaders();
        expect(headers).toHaveLength(1);
        expect(headers[0]).toContain('prefs=');
        expect(headers[0]).toContain(JSON.stringify({ lang: 'fr', fontSize: 18 }));
      });
    });

    it('applies configured cookie options', () => {
      const theme = defineCookie('theme', {
        codec: themeCodec,
        httpOnly: false,
        maxAge: 86400,
        sameSite: 'strict',
        path: '/app',
      });

      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        theme.set('dark');

        const headers = getSetCookieHeaders();
        expect(headers[0]).toContain('Path=/app');
        expect(headers[0]).toContain('Max-Age=86400');
        expect(headers[0]).toContain('SameSite=Strict');
        expect(headers[0]).not.toContain('HttpOnly');
      });
    });

    it('deletes cookie when serialize returns null', () => {
      const session = defineCookie('session', {
        codec: stringCodec,
        path: '/',
      });

      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        // Empty string → serialize returns null → delete
        session.set('');

        const headers = getSetCookieHeaders();
        expect(headers).toHaveLength(1);
        expect(headers[0]).toContain('Max-Age=0');
      });
    });

    it('throws in read-only context', () => {
      const theme = defineCookie('theme', { codec: themeCodec });

      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        expect(() => theme.set('dark')).toThrow('cannot be called in this context');
      });
    });
  });

  describe('.delete()', () => {
    it('deletes the cookie', () => {
      const theme = defineCookie('theme', { codec: themeCodec, path: '/app' });

      const req = new Request('http://localhost/test', {
        headers: { Cookie: 'theme=dark' },
      });

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        theme.delete();

        const headers = getSetCookieHeaders();
        expect(headers).toHaveLength(1);
        expect(headers[0]).toContain('theme=');
        expect(headers[0]).toContain('Max-Age=0');
      });
    });

    it('throws in read-only context', () => {
      const theme = defineCookie('theme', { codec: themeCodec });

      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        expect(() => theme.delete()).toThrow('cannot be called in this context');
      });
    });
  });

  describe('read-your-own-writes', () => {
    it('reads back a value set in the same request', () => {
      const theme = defineCookie('theme', { codec: themeCodec });

      const req = new Request('http://localhost/test', {
        headers: { Cookie: 'theme=light' },
      });

      runWithRequestContext(req, () => {
        expect(theme.get()).toBe('light');

        setMutableCookieContext(true);
        theme.set('dark');

        // The raw cookie value is now 'dark', and the codec parses it
        expect(theme.get()).toBe('dark');
      });
    });
  });

  describe('signed cookies', () => {
    const SECRET = 'test-secret-for-define-cookie';

    afterEach(() => {
      setCookieSecrets([]);
    });

    it('signs on write and verifies on read', () => {
      setCookieSecrets([SECRET]);

      const session = defineCookie('session', {
        codec: stringCodec,
        signed: true,
      });

      const req = new Request('http://localhost/test');

      runWithRequestContext(req, () => {
        setMutableCookieContext(true);
        session.set('abc123');

        // Read it back — getSigned should verify
        const value = session.get();
        expect(value).toBe('abc123');
      });
    });

    it('returns default for tampered signed cookie', () => {
      setCookieSecrets([SECRET]);

      const session = defineCookie('session', {
        codec: stringCodec,
        signed: true,
      });

      const req = new Request('http://localhost/test', {
        headers: {
          Cookie: 'session=tampered.invalidsignatureinvalidsignatureinvalidsignature1234',
        },
      });

      runWithRequestContext(req, () => {
        // getSigned returns undefined → codec.parse(undefined) → default ''
        expect(session.get()).toBe('');
      });
    });
  });

  describe('options', () => {
    it('exposes name and options on the definition', () => {
      const theme = defineCookie('theme', {
        codec: themeCodec,
        httpOnly: false,
        maxAge: 31536000,
        sameSite: 'lax',
      });

      expect(theme.name).toBe('theme');
      expect(theme.options.httpOnly).toBe(false);
      expect(theme.options.maxAge).toBe(31536000);
      expect(theme.options.sameSite).toBe('lax');
    });

    it('exposes the codec', () => {
      const theme = defineCookie('theme', { codec: themeCodec });
      expect(theme.codec).toBe(themeCodec);
    });
  });
});
