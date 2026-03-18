// @timber-js/app/search-params — Typed search params

// Core types and factory
export type {
  SearchParamCodec,
  InferCodec,
  SearchParamsDefinition,
  SetParams,
  SetParamsOptions,
  QueryStatesOptions,
  SearchParamsOptions,
} from './create.js';
export { createSearchParams } from './create.js';

// Codec bridges
export { fromSchema, fromArraySchema } from './codecs.js';

// Runtime registry (route-scoped useQueryStates)
export { registerSearchParams, getSearchParams } from './registry.js';

// Static analysis (build-time only)
export type { AnalyzeResult, AnalyzeError } from './analyze.js';
export { analyzeSearchParams, formatAnalyzeError } from './analyze.js';
