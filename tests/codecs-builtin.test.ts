/**
 * Tests for built-in search param codecs.
 *
 * TIM-362: Add built-in search param codecs (parseAsString, parseAsInteger, etc.)
 */

import { describe, expect, it } from 'vitest';
import {
  parseAsString,
  parseAsInteger,
  parseAsFloat,
  parseAsBoolean,
  parseAsStringEnum,
  parseAsStringLiteral,
  withDefault,
} from '../packages/timber-app/src/search-params/builtin-codecs.js';

// ---------------------------------------------------------------------------
// parseAsString
// ---------------------------------------------------------------------------

describe('parseAsString', () => {
  it('parses a string value', () => {
    expect(parseAsString.parse('hello')).toBe('hello');
  });

  it('returns null for undefined', () => {
    expect(parseAsString.parse(undefined)).toBe(null);
  });

  it('takes the last value from an array', () => {
    expect(parseAsString.parse(['a', 'b', 'c'])).toBe('c');
  });

  it('returns null for empty array', () => {
    expect(parseAsString.parse([] as unknown as string[])).toBe(null);
  });

  it('serializes a string', () => {
    expect(parseAsString.serialize('hello')).toBe('hello');
  });

  it('serializes null as null', () => {
    expect(parseAsString.serialize(null)).toBe(null);
  });

  it('serializes empty string as empty string', () => {
    expect(parseAsString.serialize('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseAsInteger
// ---------------------------------------------------------------------------

describe('parseAsInteger', () => {
  it('parses a valid integer', () => {
    expect(parseAsInteger.parse('42')).toBe(42);
  });

  it('parses zero', () => {
    expect(parseAsInteger.parse('0')).toBe(0);
  });

  it('parses negative integers', () => {
    expect(parseAsInteger.parse('-7')).toBe(-7);
  });

  it('returns null for undefined', () => {
    expect(parseAsInteger.parse(undefined)).toBe(null);
  });

  it('returns null for non-numeric string', () => {
    expect(parseAsInteger.parse('abc')).toBe(null);
  });

  it('returns null for float string (not an integer)', () => {
    expect(parseAsInteger.parse('3.14')).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseAsInteger.parse('')).toBe(null);
  });

  it('returns null for NaN-producing input', () => {
    expect(parseAsInteger.parse('NaN')).toBe(null);
  });

  it('returns null for Infinity', () => {
    expect(parseAsInteger.parse('Infinity')).toBe(null);
  });

  it('takes the last value from an array', () => {
    expect(parseAsInteger.parse(['1', '2', '3'])).toBe(3);
  });

  it('serializes an integer', () => {
    expect(parseAsInteger.serialize(42)).toBe('42');
  });

  it('serializes null as null', () => {
    expect(parseAsInteger.serialize(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// parseAsFloat
// ---------------------------------------------------------------------------

describe('parseAsFloat', () => {
  it('parses a valid float', () => {
    expect(parseAsFloat.parse('3.14')).toBeCloseTo(3.14);
  });

  it('parses an integer string as float', () => {
    expect(parseAsFloat.parse('42')).toBe(42);
  });

  it('parses negative floats', () => {
    expect(parseAsFloat.parse('-2.5')).toBe(-2.5);
  });

  it('returns null for undefined', () => {
    expect(parseAsFloat.parse(undefined)).toBe(null);
  });

  it('returns null for non-numeric string', () => {
    expect(parseAsFloat.parse('abc')).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseAsFloat.parse('')).toBe(null);
  });

  it('returns null for NaN', () => {
    expect(parseAsFloat.parse('NaN')).toBe(null);
  });

  it('returns null for Infinity', () => {
    expect(parseAsFloat.parse('Infinity')).toBe(null);
  });

  it('takes the last value from an array', () => {
    expect(parseAsFloat.parse(['1.1', '2.2'])).toBeCloseTo(2.2);
  });

  it('serializes a float', () => {
    expect(parseAsFloat.serialize(3.14)).toBe('3.14');
  });

  it('serializes null as null', () => {
    expect(parseAsFloat.serialize(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// parseAsBoolean
// ---------------------------------------------------------------------------

describe('parseAsBoolean', () => {
  it('parses "true" as true', () => {
    expect(parseAsBoolean.parse('true')).toBe(true);
  });

  it('parses "1" as true', () => {
    expect(parseAsBoolean.parse('1')).toBe(true);
  });

  it('parses "false" as false', () => {
    expect(parseAsBoolean.parse('false')).toBe(false);
  });

  it('parses "0" as false', () => {
    expect(parseAsBoolean.parse('0')).toBe(false);
  });

  it('returns null for undefined', () => {
    expect(parseAsBoolean.parse(undefined)).toBe(null);
  });

  it('returns null for unrecognized string', () => {
    expect(parseAsBoolean.parse('yes')).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseAsBoolean.parse('')).toBe(null);
  });

  it('takes the last value from an array', () => {
    expect(parseAsBoolean.parse(['false', 'true'])).toBe(true);
  });

  it('serializes true as "true"', () => {
    expect(parseAsBoolean.serialize(true)).toBe('true');
  });

  it('serializes false as "false"', () => {
    expect(parseAsBoolean.serialize(false)).toBe('false');
  });

  it('serializes null as null', () => {
    expect(parseAsBoolean.serialize(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// parseAsStringEnum
// ---------------------------------------------------------------------------

describe('parseAsStringEnum', () => {
  const codec = parseAsStringEnum(['asc', 'desc', 'relevance']);

  it('parses a valid enum value', () => {
    expect(codec.parse('asc')).toBe('asc');
  });

  it('returns null for invalid value', () => {
    expect(codec.parse('invalid')).toBe(null);
  });

  it('returns null for undefined', () => {
    expect(codec.parse(undefined)).toBe(null);
  });

  it('returns null for empty string when not in enum', () => {
    expect(codec.parse('')).toBe(null);
  });

  it('takes the last value from an array', () => {
    expect(codec.parse(['asc', 'desc'])).toBe('desc');
  });

  it('serializes a valid value', () => {
    expect(codec.serialize('asc')).toBe('asc');
  });

  it('serializes null as null', () => {
    expect(codec.serialize(null)).toBe(null);
  });

  it('works with empty string in allowed values', () => {
    const withEmpty = parseAsStringEnum(['', 'a', 'b']);
    expect(withEmpty.parse('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseAsStringLiteral
// ---------------------------------------------------------------------------

describe('parseAsStringLiteral', () => {
  const codec = parseAsStringLiteral(['sm', 'md', 'lg', 'xl'] as const);

  it('parses a valid literal value', () => {
    expect(codec.parse('md')).toBe('md');
  });

  it('returns null for invalid value', () => {
    expect(codec.parse('xxl')).toBe(null);
  });

  it('returns null for undefined', () => {
    expect(codec.parse(undefined)).toBe(null);
  });

  it('takes the last value from an array', () => {
    expect(codec.parse(['sm', 'xl'])).toBe('xl');
  });

  it('serializes a valid value', () => {
    expect(codec.serialize('lg')).toBe('lg');
  });

  it('serializes null as null', () => {
    expect(codec.serialize(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// withDefault
// ---------------------------------------------------------------------------

describe('withDefault', () => {
  it('wraps parseAsString with a default', () => {
    const codec = withDefault(parseAsString, 'fallback');
    expect(codec.parse(undefined)).toBe('fallback');
    expect(codec.parse('hello')).toBe('hello');
  });

  it('wraps parseAsInteger with a default', () => {
    const codec = withDefault(parseAsInteger, 0);
    expect(codec.parse(undefined)).toBe(0);
    expect(codec.parse('abc')).toBe(0);
    expect(codec.parse('42')).toBe(42);
  });

  it('wraps parseAsFloat with a default', () => {
    const codec = withDefault(parseAsFloat, 1.0);
    expect(codec.parse(undefined)).toBe(1.0);
    expect(codec.parse('abc')).toBe(1.0);
    expect(codec.parse('3.14')).toBeCloseTo(3.14);
  });

  it('wraps parseAsBoolean with a default', () => {
    const codec = withDefault(parseAsBoolean, false);
    expect(codec.parse(undefined)).toBe(false);
    expect(codec.parse('yes')).toBe(false);
    expect(codec.parse('true')).toBe(true);
  });

  it('wraps parseAsStringEnum with a default', () => {
    const codec = withDefault(parseAsStringEnum(['asc', 'desc']), 'asc');
    expect(codec.parse(undefined)).toBe('asc');
    expect(codec.parse('invalid')).toBe('asc');
    expect(codec.parse('desc')).toBe('desc');
  });

  it('preserves serialize behavior', () => {
    const codec = withDefault(parseAsInteger, 0);
    expect(codec.serialize(42)).toBe('42');
    // null is no longer possible when default is set, but serialize should handle gracefully
    expect(codec.serialize(0)).toBe('0');
  });

  it('serializes the underlying codec (no wrapping)', () => {
    const codec = withDefault(parseAsString, 'default');
    expect(codec.serialize('hello')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Integration: codecs work with createSearchParams
// ---------------------------------------------------------------------------

describe('integration with createSearchParams', () => {
  // Dynamic import to avoid pulling in the full create module's dependencies
  // unless this test runs
  it('works as codecs in createSearchParams', async () => {
    const { createSearchParams } = await import(
      '../packages/timber-app/src/search-params/create.js'
    );

    const def = createSearchParams({
      q: parseAsString,
      page: withDefault(parseAsInteger, 1),
      desc: withDefault(parseAsBoolean, false),
      sort: withDefault(parseAsStringEnum(['price', 'name', 'date']), 'date'),
    });

    // Parse from URLSearchParams
    const params = new URLSearchParams('q=shoes&page=2&sort=price');
    const result = def.parse(params);

    expect(result.q).toBe('shoes');
    expect(result.page).toBe(2);
    expect(result.desc).toBe(false);
    expect(result.sort).toBe('price');
  });

  it('parse defaults when params are missing', async () => {
    const { createSearchParams } = await import(
      '../packages/timber-app/src/search-params/create.js'
    );

    const def = createSearchParams({
      page: withDefault(parseAsInteger, 1),
      sort: withDefault(parseAsStringEnum(['price', 'name']), 'price'),
    });

    const result = def.parse(new URLSearchParams(''));
    expect(result.page).toBe(1);
    expect(result.sort).toBe('price');
  });

  it('serialize omits default values', async () => {
    const { createSearchParams } = await import(
      '../packages/timber-app/src/search-params/create.js'
    );

    const def = createSearchParams({
      page: withDefault(parseAsInteger, 1),
      q: parseAsString,
    });

    // page=1 is the default, should be omitted
    expect(def.serialize({ page: 1, q: 'shoes' })).toBe('q=shoes');
    // page=2 is not default, should be included
    expect(def.serialize({ page: 2, q: 'shoes' })).toBe('page=2&q=shoes');
  });
});
