/**
 * FormData preprocessing — schema-agnostic conversion of FormData to typed objects.
 *
 * FormData is all strings. Schema validation expects typed values. This module
 * bridges the gap with intelligent coercion that runs *before* schema validation.
 *
 * Inspired by zod-form-data, but schema-agnostic — works with any Standard Schema
 * library (Zod, Valibot, ArkType).
 *
 * See design/08-forms-and-actions.md §"parseFormData() and coerce helpers"
 */

// ─── parseFormData ───────────────────────────────────────────────────────

/**
 * Convert FormData into a plain object with intelligent coercion.
 *
 * Handles:
 * - **Duplicate keys → arrays**: `tags=js&tags=ts` → `{ tags: ["js", "ts"] }`
 * - **Nested dot-paths**: `user.name=Alice` → `{ user: { name: "Alice" } }`
 * - **Empty strings → undefined**: Enables `.optional()` semantics in schemas
 * - **Empty Files → undefined**: File inputs with no selection become `undefined`
 * - **Strips `$ACTION_*` fields**: React's internal hidden fields are excluded
 */
export function parseFormData(formData: FormData): Record<string, unknown> {
  const flat: Record<string, unknown> = {};

  for (const key of new Set(formData.keys())) {
    // Skip React internal fields
    if (key.startsWith('$ACTION_')) continue;

    const values = formData.getAll(key);
    const processed = values.map(normalizeValue);

    if (processed.length === 1) {
      flat[key] = processed[0];
    } else {
      // Filter out undefined entries from multi-value fields
      flat[key] = processed.filter((v) => v !== undefined);
    }
  }

  // Expand dot-notation paths into nested objects
  return expandDotPaths(flat);
}

/**
 * Normalize a single FormData entry value.
 * - Empty strings → undefined (enables .optional() semantics)
 * - Empty File objects (no selection) → undefined
 * - Everything else passes through as-is
 */
function normalizeValue(value: FormDataEntryValue): unknown {
  if (typeof value === 'string') {
    return value === '' ? undefined : value;
  }

  // File input with no selection: browsers submit a File with name="" and size=0
  if (value instanceof File && value.size === 0 && value.name === '') {
    return undefined;
  }

  return value;
}

/**
 * Expand dot-notation keys into nested objects.
 * `{ "user.name": "Alice", "user.age": "30" }` → `{ user: { name: "Alice", age: "30" } }`
 *
 * Keys without dots are left as-is. Bracket notation (e.g. `items[0]`) is NOT
 * supported — use dot notation (`items.0`) instead.
 */
function expandDotPaths(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let hasDotPaths = false;

  // First pass: check if any keys have dots
  for (const key of Object.keys(flat)) {
    if (key.includes('.')) {
      hasDotPaths = true;
      break;
    }
  }

  // Fast path: no dot-notation keys, return as-is
  if (!hasDotPaths) return flat;

  for (const [key, value] of Object.entries(flat)) {
    if (!key.includes('.')) {
      result[key] = value;
      continue;
    }

    const parts = key.split('.');
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || current[part] === null) {
        current[part] = {};
      }
      // If current[part] is not an object (e.g., a string from a non-dotted key),
      // the dot-path takes precedence
      if (typeof current[part] !== 'object' || current[part] instanceof File) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  return result;
}

// ─── Coercion Helpers ────────────────────────────────────────────────────

/**
 * Schema-agnostic coercion primitives for common FormData patterns.
 *
 * These are plain transform functions — they compose with any schema library's
 * `transform`/`preprocess` pipeline:
 *
 * ```ts
 * // Zod
 * z.preprocess(coerce.number, z.number())
 * // Valibot
 * v.pipe(v.unknown(), v.transform(coerce.number), v.number())
 * ```
 */
export const coerce = {
  /**
   * Coerce a string to a number.
   * - `"42"` → `42`
   * - `"3.14"` → `3.14`
   * - `""` / `undefined` / `null` → `undefined`
   * - Non-numeric strings → `undefined` (schema validation will catch this)
   */
  number(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return undefined;
    const num = Number(value);
    if (Number.isNaN(num)) return undefined;
    return num;
  },

  /**
   * Coerce a checkbox value to a boolean.
   * HTML checkboxes submit "on" when checked and are absent when unchecked.
   * - `"on"` / any truthy string → `true`
   * - `undefined` / `null` / `""` → `false`
   */
  checkbox(value: unknown): boolean {
    if (value === undefined || value === null || value === '') return false;
    if (typeof value === 'boolean') return value;
    // Any non-empty string (typically "on") is true
    return typeof value === 'string' && value.length > 0;
  },

  /**
   * Parse a JSON string into an object.
   * - Valid JSON string → parsed object
   * - `""` / `undefined` / `null` → `undefined`
   * - Invalid JSON → `undefined` (schema validation will catch this)
   */
  json(value: unknown): unknown {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  },
};
