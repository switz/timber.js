import { describe, it, expect } from 'vitest';
import { canonicalize } from '../packages/timber-app/src/server/canonicalize';

describe('canonicalize()', () => {
  // ─── Single percent-decode ──────────────────────────────────────────────

  it('single percent-decode', () => {
    const result = canonicalize('/%61dmin');
    expect(result).toEqual({ ok: true, pathname: '/admin' });
  });

  it('double-encoded stays partially decoded', () => {
    // %2561 → single decode → %61 (not decoded again to "a")
    const result = canonicalize('/%2561dmin');
    expect(result).toEqual({ ok: true, pathname: '/%61dmin' });
  });

  it('preserves already-decoded characters', () => {
    const result = canonicalize('/hello/world');
    expect(result).toEqual({ ok: true, pathname: '/hello/world' });
  });

  // ─── Collapse and resolve ───────────────────────────────────────────────

  it('collapse and resolve', () => {
    const result = canonicalize('//foo///bar');
    expect(result).toEqual({ ok: true, pathname: '/foo/bar' });
  });

  it('resolves .. segments', () => {
    const result = canonicalize('/foo/bar/../baz');
    expect(result).toEqual({ ok: true, pathname: '/foo/baz' });
  });

  it('resolves . segments', () => {
    const result = canonicalize('/foo/./bar');
    expect(result).toEqual({ ok: true, pathname: '/foo/bar' });
  });

  it('rejects .. that escapes root', () => {
    const result = canonicalize('/../etc/passwd');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('strips trailing slash by default', () => {
    const result = canonicalize('/foo/bar/');
    expect(result).toEqual({ ok: true, pathname: '/foo/bar' });
  });

  it('preserves trailing slash when configured', () => {
    const result = canonicalize('/foo/bar/', false);
    expect(result).toEqual({ ok: true, pathname: '/foo/bar/' });
  });

  it('root path stays as /', () => {
    const result = canonicalize('/');
    expect(result).toEqual({ ok: true, pathname: '/' });
  });

  // ─── Encoded separator rejection ───────────────────────────────────────

  it('encoded separator rejection — %2f', () => {
    const result = canonicalize('/foo%2fbar');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('encoded separator rejection — %2F (uppercase)', () => {
    const result = canonicalize('/foo%2Fbar');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('encoded separator rejection — %5c (backslash)', () => {
    const result = canonicalize('/foo%5cbar');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('encoded separator rejection — %5C (uppercase)', () => {
    const result = canonicalize('/foo%5Cbar');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  // ─── Null byte rejection ───────────────────────────────────────────────

  it('null byte rejection', () => {
    const result = canonicalize('/foo%00bar');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('null byte rejection — uppercase', () => {
    const result = canonicalize('/foo%00bar');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  // ─── Backslash handling ─────────────────────────────────────────────────

  it('backslash is not a path separator', () => {
    // Literal backslash in path — should NOT become //
    const result = canonicalize('/\\evil.com');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The backslash should be preserved as a literal character
      expect(result.pathname).not.toBe('//evil.com');
      expect(result.pathname).toContain('\\');
    }
  });

  // ─── Malformed encoding ─────────────────────────────────────────────────

  it('rejects malformed percent-encoding', () => {
    const result = canonicalize('/foo%GGbar');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  // ─── Security test cases from design/13-security.md ─────────────────────

  it('security: %2561dmin decoded once to %61dmin, not /admin', () => {
    const result = canonicalize('/%2561dmin');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pathname).toBe('/%61dmin');
      expect(result.pathname).not.toBe('/admin');
    }
  });

  it('security: path traversal with encoded separator', () => {
    // GET /foo/..%2fadmin → 400 (encoded separator rejected)
    const result = canonicalize('/foo/..%2fadmin');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('security: null byte in path', () => {
    const result = canonicalize('/foo%00bar');
    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('security: backslash confusion /\\evil.com', () => {
    const result = canonicalize('/\\evil.com');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Must NOT become //evil.com (protocol-relative URL)
      expect(result.pathname).not.toMatch(/^\/\//);
    }
  });
});
