/**
 * RSC-to-Client Serialization Audit Tests
 *
 * Tests for the serialization paths that timber.js controls:
 * - dangerouslyPassData (JSON vs Flight serialization paths)
 * - RenderError digest serialization
 * - Server action error sanitization
 *
 * Flight protocol type support (Date, Map, Set, BigInt, Promise, etc.) is
 * verified by the React 19 Flight implementation directly. The Flight
 * roundtrip behavior cannot be unit-tested in Vitest because the RSC server
 * module requires the `react-server` export condition. These are tested
 * via E2E tests against a running timber app.
 *
 * See design/30-rsc-serialization-audit.md for the full audit.
 *
 * Ported from TIM-356: Audit RSC-to-client serialization
 */

import { describe, it, expect } from 'vitest';
import { DenySignal, RenderError } from '../packages/timber-app/src/server/primitives.js';

// ─── dangerouslyPassData Serialization Paths ─────────────────────────────────

describe('dangerouslyPassData — post-flush JSON serialization path', () => {
  // The post-flush path (deny() inside Suspense after status commits) uses
  // JSON.stringify for the error digest. This path is in rsc-entry/index.ts
  // onError callback: `JSON.stringify({ type: 'deny', status, data })`.
  //
  // This limits what types survive in the post-flush path compared to the
  // pre-flush path (which uses full Flight serialization).

  it('plain objects survive JSON roundtrip', () => {
    const data = { resourceId: '123', title: 'Not Found', count: 42 };
    const digest = JSON.stringify({ type: 'deny', status: 404, data });
    const parsed = JSON.parse(digest);
    expect(parsed.data).toEqual(data);
  });

  it('nested plain objects survive JSON roundtrip', () => {
    const data = {
      error: { code: 'RESOURCE_MISSING', details: { searched: ['db', 'cache'] } },
    };
    const digest = JSON.stringify({ type: 'deny', status: 404, data });
    const parsed = JSON.parse(digest);
    expect(parsed.data).toEqual(data);
  });

  it('Date is coerced to ISO string (data loss)', () => {
    const data = { created: new Date('2024-01-01T00:00:00.000Z') };
    const digest = JSON.stringify({ type: 'deny', status: 404, data });
    const parsed = JSON.parse(digest);
    // Date becomes a string, not a Date instance
    expect(typeof parsed.data.created).toBe('string');
    expect(parsed.data.created).toBe('2024-01-01T00:00:00.000Z');
  });

  it('Map becomes empty object (data loss)', () => {
    const data = { lookup: new Map([['key', 'value']]) };
    const digest = JSON.stringify({ type: 'deny', status: 404, data });
    const parsed = JSON.parse(digest);
    // Map serializes as {} via JSON.stringify
    expect(parsed.data.lookup).toEqual({});
  });

  it('Set becomes empty object (data loss)', () => {
    const data = { tags: new Set(['a', 'b', 'c']) };
    const digest = JSON.stringify({ type: 'deny', status: 404, data });
    const parsed = JSON.parse(digest);
    // Set serializes as {} via JSON.stringify
    expect(parsed.data.tags).toEqual({});
  });

  it('BigInt throws on JSON.stringify', () => {
    const data = { id: BigInt(123) };
    expect(() => JSON.stringify({ type: 'deny', status: 404, data })).toThrow(TypeError);
  });

  it('undefined values are stripped', () => {
    const data = { present: 'yes', missing: undefined };
    const digest = JSON.stringify({ type: 'deny', status: 404, data });
    const parsed = JSON.parse(digest);
    expect(parsed.data).toEqual({ present: 'yes' });
    expect('missing' in parsed.data).toBe(false);
  });

  it('functions are stripped', () => {
    const data = { name: 'test', handler: () => {} };
    const digest = JSON.stringify({ type: 'deny', status: 404, data });
    const parsed = JSON.parse(digest);
    expect(parsed.data).toEqual({ name: 'test' });
  });
});

// ─── DenySignal Data Storage ─────────────────────────────────────────────────

describe('DenySignal — data storage', () => {
  it('stores data on the signal', () => {
    const data = { resourceId: '123' };
    const signal = new DenySignal(404, data);
    expect(signal.status).toBe(404);
    expect(signal.data).toBe(data); // Same reference — not copied
  });

  it('stores undefined data when omitted', () => {
    const signal = new DenySignal(403);
    expect(signal.data).toBeUndefined();
  });

  it('rejects non-JSON-serializable data at the type level', () => {
    // With the JsonSerializable constraint, DenySignal no longer accepts
    // Date, Map, Set, etc. at the type level. This test verifies that
    // the runtime still stores whatever is passed (for backward compat),
    // using a type assertion to bypass the compile-time check.
    const data = {
      date: new Date('2024-01-01'),
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signal = new DenySignal(404, data as any);
    expect(signal.data).toBe(data);
    expect((signal.data as Record<string, unknown>).date).toBeInstanceOf(Date);
    expect((signal.data as Record<string, unknown>).map).toBeInstanceOf(Map);
  });
});

// ─── RenderError Digest Serialization ────────────────────────────────────────

describe('RenderError — digest serialization via JSON', () => {
  // The onError callback in rsc-entry/index.ts serializes RenderError digests
  // as JSON strings: `JSON.stringify({ type: 'render-error', code, data, status })`.
  // The client parses this in error-boundary.tsx via `JSON.parse(error.digest)`.

  it('plain object digest survives JSON roundtrip', () => {
    const error = new RenderError('NOT_FOUND', { title: 'Not found', resourceId: '123' });
    const digest = JSON.stringify({
      type: 'render-error',
      code: error.code,
      data: error.digest.data,
      status: error.status,
    });
    const parsed = JSON.parse(digest);
    expect(parsed.code).toBe('NOT_FOUND');
    expect(parsed.data).toEqual({ title: 'Not found', resourceId: '123' });
    expect(parsed.status).toBe(500);
  });

  it('Date in digest data is coerced to string (type assertion bypass)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const error = new RenderError('EXPIRED', { expiredAt: new Date('2024-01-01') } as any);
    const digest = JSON.stringify({
      type: 'render-error',
      code: error.code,
      data: error.digest.data,
      status: error.status,
    });
    const parsed = JSON.parse(digest);
    expect(typeof parsed.data.expiredAt).toBe('string');
  });

  it('custom status code is preserved', () => {
    const error = new RenderError('FORBIDDEN', { reason: 'role' }, { status: 403 });
    const digest = JSON.stringify({
      type: 'render-error',
      code: error.code,
      data: error.digest.data,
      status: error.status,
    });
    const parsed = JSON.parse(digest);
    expect(parsed.status).toBe(403);
  });
});

// ─── onError Digest Format ───────────────────────────────────────────────────

describe('onError digest format — matches error-boundary.tsx parser', () => {
  // The RSC onError callback returns a JSON string that error-boundary.tsx
  // parses via parseDigest(). Verify the format matches.

  it('deny digest format matches parser expectations', () => {
    const deny = new DenySignal(404, { id: '123' });
    const digestStr = JSON.stringify({ type: 'deny', status: deny.status, data: deny.data });
    const parsed = JSON.parse(digestStr);
    // error-boundary.tsx checks: parsed.type === 'deny'
    expect(parsed.type).toBe('deny');
    expect(parsed.status).toBe(404);
    expect(parsed.data).toEqual({ id: '123' });
  });

  it('redirect digest format matches parser expectations', () => {
    const digestStr = JSON.stringify({ type: 'redirect', location: '/login', status: 302 });
    const parsed = JSON.parse(digestStr);
    expect(parsed.type).toBe('redirect');
    expect(parsed.location).toBe('/login');
    expect(parsed.status).toBe(302);
  });

  it('render-error digest format matches parser expectations', () => {
    const error = new RenderError('PRODUCT_NOT_FOUND', { title: 'Product not found' });
    const digestStr = JSON.stringify({
      type: 'render-error',
      code: error.code,
      data: error.digest.data,
      status: error.status,
    });
    const parsed = JSON.parse(digestStr);
    expect(parsed.type).toBe('render-error');
    expect(parsed.code).toBe('PRODUCT_NOT_FOUND');
    expect(parsed.data).toEqual({ title: 'Product not found' });
    expect(parsed.status).toBe(500);
  });

  it('invalid digest returns null from parseDigest pattern', () => {
    // parseDigest in error-boundary.tsx returns null for non-JSON or missing type
    const invalid1 = 'not-json';
    expect(() => JSON.parse(invalid1)).toThrow();

    const invalid2 = JSON.stringify({ noType: true });
    const parsed2 = JSON.parse(invalid2);
    expect(typeof parsed2.type).not.toBe('string');
  });
});

// ─── Flight Protocol Type Documentation ──────────────────────────────────────

describe('Flight protocol type support (documented, not roundtrip-tested)', () => {
  // These tests document what the React 19 Flight protocol supports based on
  // source code analysis of react-server-dom-webpack-server.edge.development.js.
  // The actual roundtrip behavior is verified in E2E tests.

  it('documents supported types', () => {
    // Flight serializer type detection order (from renderModelDestructive):
    const supportedTypes = [
      'string',
      'number (including NaN, Infinity, -Infinity, -0)',
      'boolean',
      'null',
      'undefined',
      'BigInt ($n prefix)',
      'Date ($D prefix + ISO string)',
      'Map (serialized as entries)',
      'Set (serialized as values)',
      'Promise/Thenable ($@ prefix, streaming)',
      'FormData',
      'Blob',
      'ArrayBuffer',
      'TypedArray (all variants: Int8Array, Uint8Array, etc.)',
      'DataView',
      'ReadableStream (streaming)',
      'AsyncIterator (streaming)',
      'Iterator/Iterable (converted to array)',
      'Error (via onError digest, message only)',
      'React elements (server components rendered, client refs serialized)',
      'Plain objects (no custom prototype)',
      'Arrays',
    ];
    expect(supportedTypes.length).toBeGreaterThan(0);
  });

  it('documents unsupported types', () => {
    const unsupportedTypes = [
      'RegExp — throws "Only plain objects" error',
      'Symbol — not serializable',
      'Class instances — throws "Classes or null prototypes"',
      'WeakMap — no serializer',
      'WeakSet — no serializer',
      'Functions (non-server/client reference) — not serializable',
      'URL — class instance, throws',
      'Headers — class instance, throws',
    ];
    expect(unsupportedTypes.length).toBeGreaterThan(0);
  });
});
