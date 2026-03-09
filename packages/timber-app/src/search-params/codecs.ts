/**
 * Built-in codecs and the fromSchema bridge for Standard Schema-compatible
 * validation libraries (Zod, Valibot, ArkType).
 *
 * Design doc: design/09-typescript.md §"The SearchParamCodec Protocol"
 */

import type { SearchParamCodec } from './create.js';

// ---------------------------------------------------------------------------
// Standard Schema interface (subset)
//
// Standard Schema (https://github.com/standard-schema/standard-schema) defines
// a minimal interface that Zod ≥3.24, Valibot ≥1.0, and ArkType all implement.
// We depend only on `~standard.validate` to avoid coupling to any specific lib.
// ---------------------------------------------------------------------------

interface StandardSchemaV1<Output = unknown> {
  '~standard': {
    validate(value: unknown): StandardSchemaResult<Output>;
  };
}

type StandardSchemaResult<Output> =
  | { value: Output; issues?: undefined }
  | { value?: undefined; issues: ReadonlyArray<{ message: string }> };

// ---------------------------------------------------------------------------
// fromSchema — bridge from Standard Schema to SearchParamCodec
// ---------------------------------------------------------------------------

/**
 * Bridge a Standard Schema-compatible schema (Zod, Valibot, ArkType) to a
 * SearchParamCodec.
 *
 * Parse: coerces the raw URL string through the schema. On validation failure,
 * parses `undefined` to get the schema's default value (the schema should have
 * a `.default()` call). If that also fails, returns `undefined`.
 *
 * Serialize: uses `String()` for primitives, `null` for null/undefined.
 *
 * ```ts
 * import { fromSchema } from '@timber/app/search-params'
 * import { z } from 'zod'
 *
 * const pageCodec = fromSchema(z.coerce.number().int().min(1).default(1))
 * ```
 */
export function fromSchema<T>(schema: StandardSchemaV1<T>): SearchParamCodec<T> {
  return {
    parse(value: string | string[] | undefined): T {
      // For array inputs, take the last value (consistent with URLSearchParams.get())
      const input = Array.isArray(value) ? value[value.length - 1] : value;

      // Try parsing the raw value
      const result = schema['~standard'].validate(input);
      if (!result.issues) {
        return result.value;
      }

      // On failure, try parsing undefined to get the default
      const defaultResult = schema['~standard'].validate(undefined);
      if (!defaultResult.issues) {
        return defaultResult.value;
      }

      // No default available — return undefined (codec design choice)
      return undefined as T;
    },

    serialize(value: T): string | null {
      if (value === null || value === undefined) {
        return null;
      }
      return String(value);
    },
  };
}

// ---------------------------------------------------------------------------
// fromArraySchema — bridge for array-valued search params
// ---------------------------------------------------------------------------

/**
 * Bridge a Standard Schema for array values. Handles both single strings
 * and repeated query keys (`?tag=a&tag=b`).
 *
 * ```ts
 * import { fromArraySchema } from '@timber/app/search-params'
 * import { z } from 'zod'
 *
 * const tagsCodec = fromArraySchema(z.array(z.string()).default([]))
 * ```
 */
export function fromArraySchema<T>(schema: StandardSchemaV1<T>): SearchParamCodec<T> {
  return {
    parse(value: string | string[] | undefined): T {
      // Coerce single string to array for array schemas
      let input: unknown = value;
      if (typeof value === 'string') {
        input = [value];
      } else if (value === undefined) {
        input = undefined;
      }

      const result = schema['~standard'].validate(input);
      if (!result.issues) {
        return result.value;
      }

      // On failure, try undefined for default
      const defaultResult = schema['~standard'].validate(undefined);
      if (!defaultResult.issues) {
        return defaultResult.value;
      }

      return undefined as T;
    },

    serialize(value: T): string | null {
      if (value === null || value === undefined) {
        return null;
      }
      if (Array.isArray(value)) {
        return value.length === 0 ? null : value.join(',');
      }
      return String(value);
    },
  };
}
