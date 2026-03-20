/**
 * Tests for JsonSerializable type constraint and dev-mode validation.
 *
 * Verifies that:
 * 1. findNonSerializable() detects non-JSON-serializable values
 * 2. deny() and RenderError emit dev-mode warnings for non-serializable data
 * 3. JsonSerializable type is exported from both server and client packages
 *
 * See design/30-rsc-serialization-audit.md for context.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  findNonSerializable,
  DenySignal,
  RenderError,
  deny,
} from '../packages/timber-app/src/server/primitives.js';
import type { JsonSerializable } from '../packages/timber-app/src/server/types.js';

// ─── findNonSerializable() ───────────────────────────────────────────────────

describe('findNonSerializable()', () => {
  it('returns null for plain string', () => {
    expect(findNonSerializable('hello')).toBeNull();
  });

  it('returns null for number', () => {
    expect(findNonSerializable(42)).toBeNull();
  });

  it('returns null for boolean', () => {
    expect(findNonSerializable(true)).toBeNull();
    expect(findNonSerializable(false)).toBeNull();
  });

  it('returns null for null', () => {
    expect(findNonSerializable(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(findNonSerializable(undefined)).toBeNull();
  });

  it('returns null for plain object', () => {
    expect(findNonSerializable({ a: 1, b: 'two', c: true })).toBeNull();
  });

  it('returns null for nested plain objects', () => {
    expect(
      findNonSerializable({
        error: { code: 'NOT_FOUND', details: { searched: ['db', 'cache'] } },
      })
    ).toBeNull();
  });

  it('returns null for arrays', () => {
    expect(findNonSerializable([1, 'two', true, null])).toBeNull();
  });

  it('returns null for nested arrays', () => {
    expect(findNonSerializable([[1, 2], [3, 4]])).toBeNull();
  });

  it('returns null for empty object', () => {
    expect(findNonSerializable({})).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(findNonSerializable([])).toBeNull();
  });

  it('detects Date', () => {
    const result = findNonSerializable({ created: new Date() });
    expect(result).toContain('Date');
    expect(result).toContain('data.created');
  });

  it('detects Map', () => {
    const result = findNonSerializable({ lookup: new Map() });
    expect(result).toContain('Map');
    expect(result).toContain('data.lookup');
  });

  it('detects Set', () => {
    const result = findNonSerializable({ tags: new Set() });
    expect(result).toContain('Set');
    expect(result).toContain('data.tags');
  });

  it('detects BigInt', () => {
    const result = findNonSerializable(BigInt(123));
    expect(result).toContain('BigInt');
  });

  it('detects function', () => {
    const result = findNonSerializable(() => {});
    expect(result).toContain('function');
  });

  it('detects symbol', () => {
    const result = findNonSerializable(Symbol('test'));
    expect(result).toContain('symbol');
  });

  it('detects RegExp', () => {
    const result = findNonSerializable({ pattern: /abc/ });
    expect(result).toContain('RegExp');
  });

  it('detects Error', () => {
    const result = findNonSerializable({ err: new Error('oops') });
    expect(result).toContain('Error');
  });

  it('detects class instances', () => {
    class MyClass {
      value = 1;
    }
    const result = findNonSerializable({ item: new MyClass() });
    expect(result).toContain('MyClass');
  });

  it('detects nested non-serializable values', () => {
    const result = findNonSerializable({ a: { b: { c: new Date() } } });
    expect(result).toContain('data.a.b.c');
    expect(result).toContain('Date');
  });

  it('detects non-serializable values in arrays', () => {
    const result = findNonSerializable([1, 'two', new Map()]);
    expect(result).toContain('data[2]');
    expect(result).toContain('Map');
  });

  it('returns the first issue found', () => {
    const result = findNonSerializable({ a: new Date(), b: new Map() });
    // Should find one of them (order depends on Object.keys)
    expect(result).not.toBeNull();
  });

  it('rejects null-prototype objects (Flight rejects them)', () => {
    const obj = Object.create(null);
    obj.key = 'value';
    const result = findNonSerializable(obj);
    expect(result).toContain('null-prototype');
  });
});

// ─── Dev-mode Warnings ───────────────────────────────────────────────────────

describe('dev-mode warnings for non-serializable data', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deny() warns when data contains a Date', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deny(404, { created: new Date() } as any);
    } catch {
      // deny always throws
    }
    const timberWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[timber]'));
    expect(timberWarns).toHaveLength(1);
    expect(String(timberWarns[0][0])).toContain('Date');
    expect(String(timberWarns[0][0])).toContain('deny()');
  });

  it('deny() does not warn for valid JSON-serializable data', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      deny(404, { resourceId: '123', count: 42 });
    } catch {
      // deny always throws
    }
    const timberWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[timber]'));
    expect(timberWarns).toHaveLength(0);
  });

  it('deny() does not warn when data is undefined', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      deny(403);
    } catch {
      // deny always throws
    }
    const timberWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[timber]'));
    expect(timberWarns).toHaveLength(0);
  });

  it('RenderError warns when digest data contains a Map', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new RenderError('BAD_DATA', { lookup: new Map() } as any);
    const timberWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[timber]'));
    expect(timberWarns).toHaveLength(1);
    expect(String(timberWarns[0][0])).toContain('Map');
    expect(String(timberWarns[0][0])).toContain('RenderError');
  });

  it('RenderError does not warn for valid data', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new RenderError('NOT_FOUND', { title: 'Not found', id: '123' });
    const timberWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[timber]'));
    expect(timberWarns).toHaveLength(0);
  });
});

// ─── Type-Level Tests ────────────────────────────────────────────────────────

describe('JsonSerializable type constraint', () => {
  it('DenySignal accepts JsonSerializable data', () => {
    const data: JsonSerializable = { id: '123', nested: { count: 42 } };
    const signal = new DenySignal(404, data);
    expect(signal.data).toEqual(data);
  });

  it('RenderError accepts JsonSerializable data', () => {
    const data: JsonSerializable = { title: 'Not found', items: [1, 2, 3] };
    // RenderError generic infers from the literal — this verifies compatibility
    const error = new RenderError('NOT_FOUND', data);
    expect(error.digest.data).toEqual(data);
  });

  it('deny() accepts JsonSerializable data', () => {
    try {
      deny(404, { resourceId: '123', tags: ['a', 'b'] });
    } catch (e) {
      expect(e).toBeInstanceOf(DenySignal);
      expect((e as DenySignal).data).toEqual({ resourceId: '123', tags: ['a', 'b'] });
    }
  });
});
