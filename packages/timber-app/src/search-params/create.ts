/**
 * createSearchParams — factory for SearchParamsDefinition<T>.
 *
 * Creates a typed, composable definition for a route's search parameters.
 * Supports codec protocol, URL key aliasing, default-omission serialization,
 * and composition via .extend() / .pick().
 *
 * Design doc: design/09-typescript.md §"Typed searchParams — search-params.ts"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A codec that converts between URL string values and typed values.
 *
 * nuqs parsers (parseAsInteger, parseAsString, etc.) implement this
 * interface natively — no adapter needed.
 */
export interface SearchParamCodec<T> {
  /** URL string → typed value. Receives undefined when the param is absent. */
  parse(value: string | string[] | undefined): T;
  /** Typed value → URL string. Return null to omit from URL. */
  serialize(value: T): string | null;
}

/** Infer the output type of a codec. */
export type InferCodec<C> = C extends SearchParamCodec<infer T> ? T : never;

/** Map of property names to codecs. */
export type CodecMap<T extends Record<string, unknown>> = {
  [K in keyof T]: SearchParamCodec<T[K]>;
};

/** Options for useQueryStates setter. */
export interface SetParamsOptions {
  /** Update URL without server roundtrip (default: false). */
  shallow?: boolean;
  /** Scroll to top after update (default: true). */
  scroll?: boolean;
  /** 'push' (default) or 'replace' for history state. */
  history?: 'push' | 'replace';
}

/** Setter function returned by useQueryStates. */
export type SetParams<T> = (values: Partial<T>, options?: SetParamsOptions) => void;

/** Options for useQueryStates hook. */
export interface QueryStatesOptions {
  /** Update URL without server roundtrip (default: false). */
  shallow?: boolean;
  /** Scroll to top after update (default: true). */
  scroll?: boolean;
  /** 'push' (default) or 'replace' for history state. */
  history?: 'push' | 'replace';
}

/** Options for createSearchParams and .extend(). */
export interface SearchParamsOptions<Keys extends string = string> {
  /** Map property names to different URL query parameter keys. */
  urlKeys?: Partial<Record<Keys, string>>;
}

/**
 * A fully typed, composable search params definition.
 *
 * Returned by createSearchParams(). Carries a phantom _type property
 * for build-time type extraction.
 */
export interface SearchParamsDefinition<T extends Record<string, unknown>> {
  /** Parse raw URL search params into typed values. */
  parse(raw: URLSearchParams | Record<string, string | string[] | undefined>): T;

  /** Client hook — reads current URL params and returns typed values + setter. */
  useQueryStates(options?: QueryStatesOptions): [T, SetParams<T>];

  /** Extend with additional codecs. Key collisions are a type error. */
  extend<U extends Record<string, SearchParamCodec<unknown>>>(
    codecs: U,
    options?: SearchParamsOptions<string>
  ): SearchParamsDefinition<T & { [K in keyof U]: InferCodec<U[K]> }>;

  /** Pick a subset of keys. Preserves codecs and aliases. */
  pick<K extends keyof T & string>(...keys: K[]): SearchParamsDefinition<Pick<T, K>>;

  /** Serialize values to a query string (no leading '?'), omitting defaults. */
  serialize(values: Partial<T>): string;

  /** Build a full path with query string, omitting defaults. */
  href(pathname: string, values: Partial<T>): string;

  /** Build a URLSearchParams instance, omitting defaults. */
  toSearchParams(values: Partial<T>): URLSearchParams;

  /** Read-only codec map for spreading into .extend(). Aliases NOT carried. */
  codecs: { [K in keyof T]: SearchParamCodec<T[K]> };

  /** Read-only URL key alias map. Maps property names to URL query parameter keys. */
  readonly urlKeys: Readonly<Record<string, string>>;

  /**
   * Phantom property for build-time type extraction.
   * Never set at runtime — exists only in the type system.
   */
  readonly _type?: T;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert URLSearchParams or a plain record to a normalized record
 * where repeated keys produce arrays.
 */
function normalizeRaw(
  raw: URLSearchParams | Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  if (raw instanceof URLSearchParams) {
    const result: Record<string, string | string[] | undefined> = {};
    for (const key of new Set(raw.keys())) {
      const values = raw.getAll(key);
      result[key] = values.length === 1 ? values[0] : values;
    }
    return result;
  }
  return raw;
}

/**
 * Compute the serialized default value for a codec. Used for
 * default-omission: when serialize(value) === serialize(parse(undefined)),
 * the field is omitted from the URL.
 */
function getDefaultSerialized<T>(codec: SearchParamCodec<T>): string | null {
  return codec.serialize(codec.parse(undefined));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a SearchParamsDefinition from a codec map and optional URL key aliases.
 *
 * ```ts
 * import { createSearchParams, fromSchema } from '@timber-js/app/search-params'
 * import { z } from 'zod/v4'
 *
 * export default createSearchParams({
 *   page: fromSchema(z.coerce.number().int().min(1).default(1)),
 *   q: { parse: (v) => v ?? null, serialize: (v) => v },
 * }, {
 *   urlKeys: { q: 'search' },
 * })
 * ```
 */
export function createSearchParams<C extends Record<string, SearchParamCodec<unknown>>>(
  codecs: C,
  options?: SearchParamsOptions<Extract<keyof C, string>>
): SearchParamsDefinition<{ [K in keyof C]: InferCodec<C[K]> }> {
  type T = { [K in keyof C]: InferCodec<C[K]> };
  const urlKeys: Record<string, string> = {};
  if (options?.urlKeys) {
    for (const [k, v] of Object.entries(options.urlKeys)) {
      if (v !== undefined) urlKeys[k] = v;
    }
  }

  return buildDefinition<T>(codecs as unknown as CodecMap<T>, urlKeys);
}

/**
 * Internal: build a SearchParamsDefinition from a typed codec map and url keys.
 */
function buildDefinition<T extends Record<string, unknown>>(
  codecMap: CodecMap<T>,
  urlKeys: Record<string, string>
): SearchParamsDefinition<T> {
  // Pre-compute default serialized values for omission check
  const defaultSerialized: Record<string, string | null> = {};
  for (const key of Object.keys(codecMap)) {
    defaultSerialized[key] = getDefaultSerialized(codecMap[key as keyof T]);
  }

  function getUrlKey(prop: string): string {
    return urlKeys[prop] ?? prop;
  }

  // ---- parse ----
  function parse(raw: URLSearchParams | Record<string, string | string[] | undefined>): T {
    const normalized = normalizeRaw(raw);
    const result: Record<string, unknown> = {};

    for (const prop of Object.keys(codecMap)) {
      const urlKey = getUrlKey(prop);
      const rawValue = normalized[urlKey];
      result[prop] = (codecMap[prop as keyof T] as SearchParamCodec<unknown>).parse(rawValue);
    }

    return result as T;
  }

  // ---- serialize ----
  function serialize(values: Partial<T>): string {
    const parts: string[] = [];

    for (const prop of Object.keys(codecMap)) {
      if (!(prop in values)) continue;
      const codec = codecMap[prop as keyof T] as SearchParamCodec<unknown>;
      const serialized = codec.serialize(values[prop as keyof T] as unknown);

      // Omit if serialized value matches the default
      if (serialized === defaultSerialized[prop]) continue;
      if (serialized === null) continue;

      parts.push(`${encodeURIComponent(getUrlKey(prop))}=${encodeURIComponent(serialized)}`);
    }

    return parts.join('&');
  }

  // ---- href ----
  function href(pathname: string, values: Partial<T>): string {
    const qs = serialize(values);
    return qs ? `${pathname}?${qs}` : pathname;
  }

  // ---- toSearchParams ----
  function toSearchParams(values: Partial<T>): URLSearchParams {
    const usp = new URLSearchParams();

    for (const prop of Object.keys(codecMap)) {
      if (!(prop in values)) continue;
      const codec = codecMap[prop as keyof T] as SearchParamCodec<unknown>;
      const serialized = codec.serialize(values[prop as keyof T] as unknown);

      if (serialized === defaultSerialized[prop]) continue;
      if (serialized === null) continue;

      usp.set(getUrlKey(prop), serialized);
    }

    return usp;
  }

  // ---- extend ----
  function extend<U extends Record<string, SearchParamCodec<unknown>>>(
    newCodecs: U,
    extendOptions?: SearchParamsOptions<string>
  ): SearchParamsDefinition<T & { [K in keyof U]: InferCodec<U[K]> }> {
    type Combined = T & { [K in keyof U]: InferCodec<U[K]> };

    const combinedCodecs = {
      ...codecMap,
      ...newCodecs,
    } as unknown as CodecMap<Combined>;

    // Merge URL keys: extend options override, but do NOT inherit from base
    // (aliases are route-level, not carried through .codecs)
    const combinedUrlKeys: Record<string, string> = { ...urlKeys };
    if (extendOptions?.urlKeys) {
      for (const [k, v] of Object.entries(extendOptions.urlKeys)) {
        if (v !== undefined) combinedUrlKeys[k] = v;
      }
    }

    return buildDefinition<Combined>(combinedCodecs, combinedUrlKeys);
  }

  // ---- pick ----
  function pick<K extends keyof T & string>(...keys: K[]): SearchParamsDefinition<Pick<T, K>> {
    const pickedCodecs: Record<string, SearchParamCodec<unknown>> = {};
    const pickedUrlKeys: Record<string, string> = {};

    for (const key of keys) {
      pickedCodecs[key] = codecMap[key] as SearchParamCodec<unknown>;
      if (key in urlKeys) {
        pickedUrlKeys[key] = urlKeys[key];
      }
    }

    return buildDefinition<Pick<T, K>>(
      pickedCodecs as unknown as CodecMap<Pick<T, K>>,
      pickedUrlKeys
    );
  }

  // ---- useQueryStates ----
  // This is a placeholder that will be replaced by the client runtime.
  // At import time in a server context, calling this throws.
  // The actual implementation wraps nuqs and lives in @timber-js/app/client.
  function useQueryStates(_options?: QueryStatesOptions): [T, SetParams<T>] {
    throw new Error(
      'useQueryStates() can only be called in a client component. ' +
        'Import from @timber-js/app/client instead.'
    );
  }

  const definition: SearchParamsDefinition<T> = {
    parse,
    useQueryStates,
    extend,
    pick,
    serialize,
    href,
    toSearchParams,
    codecs: codecMap,
    urlKeys: Object.freeze({ ...urlKeys }),
  };

  return definition;
}
