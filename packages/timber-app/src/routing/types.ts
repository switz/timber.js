/**
 * Route tree types for timber.js file-system routing.
 *
 * The route tree is built by scanning the app/ directory and recognizing
 * file conventions (page.*, layout.*, middleware.ts, access.ts, route.ts, etc.).
 */

/** Segment type classification */
export type SegmentType =
  | 'static' // e.g. "dashboard"
  | 'dynamic' // e.g. "[id]"
  | 'catch-all' // e.g. "[...slug]"
  | 'optional-catch-all' // e.g. "[[...slug]]"
  | 'group' // e.g. "(marketing)"
  | 'slot' // e.g. "@sidebar"

/** A single file discovered in a route segment */
export interface RouteFile {
  /** Absolute path to the file */
  filePath: string
  /** File extension without leading dot (e.g. "tsx", "ts", "mdx") */
  extension: string
}

/** A node in the segment tree */
export interface SegmentNode {
  /** The raw directory name (e.g. "dashboard", "[id]", "(auth)", "@sidebar") */
  segmentName: string
  /** Classified segment type */
  segmentType: SegmentType
  /** The dynamic param name, if dynamic (e.g. "id" for "[id]", "slug" for "[...slug]") */
  paramName?: string
  /** The URL path prefix at this segment level (e.g. "/dashboard") */
  urlPath: string

  // --- File conventions ---
  page?: RouteFile
  layout?: RouteFile
  middleware?: RouteFile
  access?: RouteFile
  route?: RouteFile
  error?: RouteFile
  default?: RouteFile
  /** Status-code files: 4xx.tsx, 5xx.tsx, {status}.tsx */
  statusFiles?: Map<string, RouteFile>
  /** denied.tsx — slot-only denial rendering */
  denied?: RouteFile

  // --- Children ---
  children: SegmentNode[]
  /** Parallel route slots (keyed by slot name without @) */
  slots: Map<string, SegmentNode>
}

/** The full route tree output from the scanner */
export interface RouteTree {
  /** The root segment node (representing app/) */
  root: SegmentNode
  /** All discovered proxy.ts files (should be at most one, in app/) */
  proxy?: RouteFile
}

/** Configuration passed to the scanner */
export interface ScannerConfig {
  /** Recognized page/layout extensions (without dots). Default: ['tsx', 'ts', 'jsx', 'js'] */
  pageExtensions?: string[]
}

/** Default page extensions */
export const DEFAULT_PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js']
