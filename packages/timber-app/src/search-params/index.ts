// @timber/app/search-params — Typed search params

export interface SearchParamCodec<T> {
  parse(raw: string | null): T
  serialize(val: T): string | null
}
