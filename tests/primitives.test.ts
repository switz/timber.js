import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  deny,
  redirect,
  redirectExternal,
  RenderError,
  waitUntil,
  DenySignal,
  RedirectSignal,
  type RenderErrorDigest,
} from '@timber/app/server'
// Internal helper for resetting warn-once state between tests
import { _resetWaitUntilWarning } from '../packages/timber-app/src/server/primitives'

// ─── deny() ─────────────────────────────────────────────────────────────────

describe('deny()', () => {
  it('throws a DenySignal', () => {
    expect(() => deny()).toThrow(DenySignal)
  })

  it('defaults to 403', () => {
    try {
      deny()
    } catch (e) {
      expect(e).toBeInstanceOf(DenySignal)
      expect((e as DenySignal).status).toBe(403)
    }
  })

  it('accepts a custom 4xx status', () => {
    try {
      deny(404)
    } catch (e) {
      expect((e as DenySignal).status).toBe(404)
    }
  })

  it('accepts 401', () => {
    try {
      deny(401)
    } catch (e) {
      expect((e as DenySignal).status).toBe(401)
    }
  })

  it('accepts 429', () => {
    try {
      deny(429)
    } catch (e) {
      expect((e as DenySignal).status).toBe(429)
    }
  })

  it('rejects non-4xx status codes', () => {
    expect(() => deny(500 as any)).toThrow()
    expect(() => deny(200 as any)).toThrow()
    expect(() => deny(301 as any)).toThrow()
  })

  it('carries data as dangerouslyPassData', () => {
    const data = { resourceId: '123', title: 'Not found' }
    try {
      deny(404, data)
    } catch (e) {
      expect((e as DenySignal).data).toEqual(data)
    }
  })

  it('data is undefined when not provided', () => {
    try {
      deny(403)
    } catch (e) {
      expect((e as DenySignal).data).toBeUndefined()
    }
  })
})

// ─── redirect() ─────────────────────────────────────────────────────────────

describe('redirect()', () => {
  it('throws a RedirectSignal for relative paths', () => {
    expect(() => redirect('/login')).toThrow(RedirectSignal)
  })

  it('defaults to 302 status', () => {
    try {
      redirect('/login')
    } catch (e) {
      expect((e as RedirectSignal).status).toBe(302)
    }
  })

  it('accepts custom 3xx status', () => {
    try {
      redirect('/login', 307)
    } catch (e) {
      expect((e as RedirectSignal).status).toBe(307)
    }
  })

  it('carries the destination path', () => {
    try {
      redirect('/dashboard')
    } catch (e) {
      expect((e as RedirectSignal).location).toBe('/dashboard')
    }
  })

  it('rejects absolute URLs', () => {
    expect(() => redirect('https://evil.com')).toThrow(/absolute/)
  })

  it('rejects protocol-relative URLs', () => {
    expect(() => redirect('//evil.com')).toThrow(/absolute|protocol/)
  })

  it('rejects URLs with other schemes', () => {
    expect(() => redirect('javascript:alert(1)' as any)).toThrow()
    expect(() => redirect('data:text/html,<h1>hi</h1>' as any)).toThrow()
  })

  it('accepts relative paths without leading slash', () => {
    try {
      redirect('settings')
    } catch (e) {
      expect((e as RedirectSignal).location).toBe('settings')
    }
  })

  it('accepts paths with query strings', () => {
    try {
      redirect('/login?returnTo=/dashboard')
    } catch (e) {
      expect((e as RedirectSignal).location).toBe('/login?returnTo=/dashboard')
    }
  })

  it('rejects non-3xx status codes', () => {
    expect(() => redirect('/login', 200 as any)).toThrow()
    expect(() => redirect('/login', 404 as any)).toThrow()
  })
})

// ─── redirectExternal() ─────────────────────────────────────────────────────

describe('redirectExternal()', () => {
  it('throws RedirectSignal for allowed URLs', () => {
    expect(() =>
      redirectExternal('https://example.com/callback', ['example.com'])
    ).toThrow(RedirectSignal)
  })

  it('rejects URLs not in the allow-list', () => {
    expect(() =>
      redirectExternal('https://evil.com/phish', ['example.com'])
    ).toThrow(/not in the allow/)
  })

  it('matches the hostname from the URL', () => {
    try {
      redirectExternal('https://example.com/path', ['example.com'])
    } catch (e) {
      expect((e as RedirectSignal).location).toBe('https://example.com/path')
    }
  })

  it('rejects with empty allow-list', () => {
    expect(() =>
      redirectExternal('https://example.com', [])
    ).toThrow(/not in the allow/)
  })

  it('defaults to 302', () => {
    try {
      redirectExternal('https://example.com', ['example.com'])
    } catch (e) {
      expect((e as RedirectSignal).status).toBe(302)
    }
  })

  it('accepts custom 3xx status', () => {
    try {
      redirectExternal('https://example.com', ['example.com'], 307)
    } catch (e) {
      expect((e as RedirectSignal).status).toBe(307)
    }
  })
})

// ─── RenderError ────────────────────────────────────────────────────────────

describe('RenderError', () => {
  it('is an Error subclass', () => {
    const err = new RenderError('NOT_FOUND', { id: '123' })
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(RenderError)
  })

  it('carries a code and digest data', () => {
    const err = new RenderError('NOT_FOUND', { title: 'Not found', id: '1' })
    expect(err.code).toBe('NOT_FOUND')
    expect(err.digest).toEqual({ code: 'NOT_FOUND', data: { title: 'Not found', id: '1' } })
  })

  it('defaults status to 500', () => {
    const err = new RenderError('INTERNAL', { reason: 'oops' })
    expect(err.status).toBe(500)
  })

  it('accepts custom status via options', () => {
    const err = new RenderError('FORBIDDEN', { msg: 'no' }, { status: 403 })
    expect(err.status).toBe(403)
  })

  it('accepts any 4xx or 5xx status', () => {
    expect(new RenderError('A', {}, { status: 404 }).status).toBe(404)
    expect(new RenderError('A', {}, { status: 503 }).status).toBe(503)
  })

  it('rejects non-error status codes', () => {
    expect(() => new RenderError('A', {}, { status: 200 as any })).toThrow()
    expect(() => new RenderError('A', {}, { status: 301 as any })).toThrow()
  })

  it('has a meaningful message', () => {
    const err = new RenderError('PRODUCT_NOT_FOUND', { id: '42' })
    expect(err.message).toContain('PRODUCT_NOT_FOUND')
  })

  it('digest is typed as RenderErrorDigest', () => {
    const err = new RenderError('MY_CODE', { foo: 'bar' })
    const digest: RenderErrorDigest<string, { foo: string }> = err.digest
    expect(digest.code).toBe('MY_CODE')
    expect(digest.data.foo).toBe('bar')
  })
})

// ─── waitUntil() ────────────────────────────────────────────────────────────

describe('waitUntil()', () => {
  beforeEach(() => {
    _resetWaitUntilWarning()
  })

  it('registers a promise with the current adapter', () => {
    const promises: Promise<unknown>[] = []
    const adapter = {
      waitUntil(p: Promise<unknown>) {
        promises.push(p)
      },
    }
    waitUntil(Promise.resolve('done'), adapter)
    expect(promises).toHaveLength(1)
  })

  it('warns once when adapter does not support waitUntil', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = {}

    waitUntil(Promise.resolve(), adapter as any)
    waitUntil(Promise.resolve(), adapter as any)

    // Should warn only once
    const timberWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('waitUntil')
    )
    expect(timberWarns).toHaveLength(1)

    warnSpy.mockRestore()
  })

  it('does not throw when adapter is missing waitUntil', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => waitUntil(Promise.resolve(), {} as any)).not.toThrow()
    warnSpy.mockRestore()
  })
})
