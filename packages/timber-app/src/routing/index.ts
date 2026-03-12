export { scanRoutes, classifySegment } from './scanner.js';
export { generateRouteMap } from './codegen.js';
export type { CodegenOptions } from './codegen.js';
export type {
  RouteTree,
  SegmentNode,
  SegmentType,
  RouteFile,
  ScannerConfig,
  InterceptionMarker,
} from './types.js';
export { DEFAULT_PAGE_EXTENSIONS, INTERCEPTION_MARKERS } from './types.js';
export { collectInterceptionRewrites } from './interception.js';
export type { InterceptionRewrite } from './interception.js';
