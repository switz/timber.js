/**
 * useQueryStates — client-side hook for URL-synced search params.
 *
 * Delegates to nuqs for URL synchronization, batching, React 19 transitions,
 * and throttled URL writes. Bridges timber's SearchParamCodec protocol to
 * nuqs-compatible parsers.
 *
 * Design doc: design/23-search-params.md §"Codec Bridge"
 */

'use client';

import { useQueryStates as nuqsUseQueryStates } from 'nuqs';
import type { SingleParser } from 'nuqs';
import type {
  SearchParamCodec,
  SearchParamsDefinition,
  SetParams,
  QueryStatesOptions,
} from '../search-params/create.js';

// ─── Codec Bridge ─────────────────────────────────────────────────

/**
 * Bridge a timber SearchParamCodec to a nuqs-compatible SingleParser.
 *
 * nuqs parsers: { parse(string) → T|null, serialize?(T) → string, eq?, defaultValue? }
 * timber codecs: { parse(string|string[]|undefined) → T, serialize(T) → string|null }
 */
function bridgeCodec<T>(codec: SearchParamCodec<T>): SingleParser<T> & { defaultValue: T } {
  return {
    parse: (v: string) => codec.parse(v),
    serialize: (v: T) => codec.serialize(v) ?? '',
    defaultValue: codec.parse(undefined) as T,
    eq: (a: T, b: T) => codec.serialize(a) === codec.serialize(b),
  };
}

/**
 * Bridge an entire codec map to nuqs-compatible parsers.
 */
function bridgeCodecs<T extends Record<string, unknown>>(codecs: {
  [K in keyof T]: SearchParamCodec<T[K]>;
}) {
  const result: Record<string, SingleParser<unknown> & { defaultValue: unknown }> = {};
  for (const key of Object.keys(codecs)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result[key] = bridgeCodec(codecs[key as keyof T]) as any;
  }
  return result as { [K in keyof T]: SingleParser<T[K]> & { defaultValue: T[K] } };
}

// ─── Hook ─────────────────────────────────────────────────────────

/**
 * Read and write typed search params from/to the URL.
 *
 * Delegates to nuqs internally. The timber nuqs adapter (auto-injected in
 * browser-entry.ts) handles RSC navigation on non-shallow updates.
 *
 * Usage:
 * ```ts
 * // Via a SearchParamsDefinition
 * const [params, setParams] = definition.useQueryStates()
 *
 * // Standalone with inline codecs
 * const [params, setParams] = useQueryStates({
 *   page: fromSchema(z.coerce.number().int().min(1).default(1)),
 * })
 * ```
 */
export function useQueryStates<T extends Record<string, unknown>>(
  codecs: { [K in keyof T]: SearchParamCodec<T[K]> },
  _options?: QueryStatesOptions,
  urlKeys?: Readonly<Record<string, string>>
): [T, SetParams<T>] {
  const bridged = bridgeCodecs(codecs);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nuqsOptions: any = {};
  if (urlKeys && Object.keys(urlKeys).length > 0) {
    nuqsOptions.urlKeys = urlKeys;
  }

  const [values, setValues] = nuqsUseQueryStates(bridged, nuqsOptions);

  // Wrap the nuqs setter to match timber's SetParams<T> signature.
  // nuqs's setter accepts Partial<Nullable<Values>> | UpdaterFn | null.
  // timber's setter accepts Partial<T> with optional SetParamsOptions.
  const setParams: SetParams<T> = (partial, setOptions?) => {
    const nuqsSetOptions: Record<string, unknown> = {};
    if (setOptions?.shallow !== undefined) nuqsSetOptions.shallow = setOptions.shallow;
    if (setOptions?.scroll !== undefined) nuqsSetOptions.scroll = setOptions.scroll;
    if (setOptions?.history !== undefined) nuqsSetOptions.history = setOptions.history;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void setValues(partial as any, nuqsSetOptions);
  };

  return [values as T, setParams];
}

// ─── Definition binding ───────────────────────────────────────────

/**
 * Create a useQueryStates binding for a SearchParamsDefinition.
 * This is used internally by SearchParamsDefinition.useQueryStates().
 */
export function bindUseQueryStates<T extends Record<string, unknown>>(
  definition: SearchParamsDefinition<T>
): (options?: QueryStatesOptions) => [T, SetParams<T>] {
  return (options?: QueryStatesOptions) => {
    return useQueryStates<T>(definition.codecs, options, definition.urlKeys);
  };
}
