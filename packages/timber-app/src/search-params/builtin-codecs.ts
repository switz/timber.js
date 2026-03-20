/**
 * Built-in search param codecs for common types.
 *
 * These provide zero-dependency alternatives to nuqs parsers for the most
 * common cases: strings, integers, floats, booleans, and string enums.
 *
 * All codecs implement SearchParamCodec<T | null> — returning null when the
 * param is absent or unparseable. Use withDefault() to replace null with a
 * concrete fallback value.
 *
 * Design doc: design/23-search-params.md §"Identified Gaps" #1
 * Task: TIM-362
 */

import type { SearchParamCodec } from './create.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize array inputs to a single string (last value wins, matching
 * URLSearchParams.get() semantics). Returns undefined if absent or empty.
 */
function normalizeInput(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[value.length - 1] : undefined;
  }
  return value;
}

// ---------------------------------------------------------------------------
// parseAsString
// ---------------------------------------------------------------------------

/**
 * String codec. Returns the raw string value, or null if absent.
 *
 * ```ts
 * import { parseAsString } from '@timber-js/app/search-params'
 *
 * const def = createSearchParams({ q: parseAsString })
 * // ?q=shoes → { q: 'shoes' }
 * // (absent) → { q: null }
 * ```
 */
export const parseAsString: SearchParamCodec<string | null> = {
  parse(value: string | string[] | undefined): string | null {
    const v = normalizeInput(value);
    return v !== undefined ? v : null;
  },
  serialize(value: string | null): string | null {
    return value;
  },
};

// ---------------------------------------------------------------------------
// parseAsInteger
// ---------------------------------------------------------------------------

/**
 * Integer codec. Parses a base-10 integer, or returns null if absent or
 * not a valid integer. Rejects floats, NaN, Infinity, and non-numeric strings.
 *
 * ```ts
 * import { parseAsInteger, withDefault } from '@timber-js/app/search-params'
 *
 * const def = createSearchParams({ page: withDefault(parseAsInteger, 1) })
 * // ?page=2 → { page: 2 }
 * // ?page=abc → { page: 1 }
 * // (absent) → { page: 1 }
 * ```
 */
export const parseAsInteger: SearchParamCodec<number | null> = {
  parse(value: string | string[] | undefined): number | null {
    const v = normalizeInput(value);
    if (v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    return n;
  },
  serialize(value: number | null): string | null {
    return value === null ? null : String(value);
  },
};

// ---------------------------------------------------------------------------
// parseAsFloat
// ---------------------------------------------------------------------------

/**
 * Float codec. Parses a finite number, or returns null if absent or invalid.
 * Rejects NaN and Infinity.
 *
 * ```ts
 * import { parseAsFloat, withDefault } from '@timber-js/app/search-params'
 *
 * const def = createSearchParams({ price: withDefault(parseAsFloat, 0) })
 * ```
 */
export const parseAsFloat: SearchParamCodec<number | null> = {
  parse(value: string | string[] | undefined): number | null {
    const v = normalizeInput(value);
    if (v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n;
  },
  serialize(value: number | null): string | null {
    return value === null ? null : String(value);
  },
};

// ---------------------------------------------------------------------------
// parseAsBoolean
// ---------------------------------------------------------------------------

/**
 * Boolean codec. Accepts "true"/"1" as true, "false"/"0" as false.
 * Returns null for absent or unrecognized values.
 *
 * ```ts
 * import { parseAsBoolean, withDefault } from '@timber-js/app/search-params'
 *
 * const def = createSearchParams({ debug: withDefault(parseAsBoolean, false) })
 * // ?debug=true → { debug: true }
 * // ?debug=0 → { debug: false }
 * ```
 */
export const parseAsBoolean: SearchParamCodec<boolean | null> = {
  parse(value: string | string[] | undefined): boolean | null {
    const v = normalizeInput(value);
    if (v === undefined) return null;
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return null;
  },
  serialize(value: boolean | null): string | null {
    return value === null ? null : String(value);
  },
};

// ---------------------------------------------------------------------------
// parseAsStringEnum
// ---------------------------------------------------------------------------

/**
 * String enum codec. Accepts only values in the provided list.
 * Returns null for absent or invalid values.
 *
 * ```ts
 * import { parseAsStringEnum, withDefault } from '@timber-js/app/search-params'
 *
 * const sortCodec = withDefault(
 *   parseAsStringEnum(['price', 'name', 'date']),
 *   'date'
 * )
 * ```
 */
export function parseAsStringEnum<T extends string>(
  values: readonly T[]
): SearchParamCodec<T | null> {
  const allowed = new Set<string>(values);
  return {
    parse(value: string | string[] | undefined): T | null {
      const v = normalizeInput(value);
      if (v === undefined) return null;
      return allowed.has(v) ? (v as T) : null;
    },
    serialize(value: T | null): string | null {
      return value;
    },
  };
}

// ---------------------------------------------------------------------------
// parseAsStringLiteral
// ---------------------------------------------------------------------------

/**
 * String literal codec. Functionally identical to parseAsStringEnum but
 * accepts `as const` tuples for narrower type inference.
 *
 * ```ts
 * import { parseAsStringLiteral } from '@timber-js/app/search-params'
 *
 * const sizes = ['sm', 'md', 'lg', 'xl'] as const
 * const codec = parseAsStringLiteral(sizes)
 * // Type: SearchParamCodec<'sm' | 'md' | 'lg' | 'xl' | null>
 * ```
 */
export function parseAsStringLiteral<const T extends readonly string[]>(
  values: T
): SearchParamCodec<T[number] | null> {
  // Delegates to parseAsStringEnum — same runtime behavior, different type
  return parseAsStringEnum<T[number]>(values);
}

// ---------------------------------------------------------------------------
// withDefault
// ---------------------------------------------------------------------------

/**
 * Wrap a nullable codec with a default value. When the inner codec returns
 * null, the default is used instead. The output type becomes non-nullable.
 *
 * ```ts
 * import { parseAsInteger, withDefault } from '@timber-js/app/search-params'
 *
 * const page = withDefault(parseAsInteger, 1)
 * // page.parse(undefined) → 1 (not null)
 * // page.parse('5') → 5
 * ```
 */
export function withDefault<T>(
  codec: SearchParamCodec<T | null>,
  defaultValue: T
): SearchParamCodec<T> {
  return {
    parse(value: string | string[] | undefined): T {
      const result = codec.parse(value);
      return result === null ? defaultValue : result;
    },
    serialize(value: T): string | null {
      return codec.serialize(value);
    },
  };
}
