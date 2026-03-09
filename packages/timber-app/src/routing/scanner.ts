/**
 * Route discovery scanner.
 *
 * Pure function: (appDir, config) → RouteTree
 *
 * Scans the app/ directory and builds a segment tree recognizing all
 * timber.js file conventions. Does NOT handle request matching — this
 * is discovery only.
 */

import { readdirSync, statSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import type {
  RouteTree,
  SegmentNode,
  SegmentType,
  RouteFile,
  ScannerConfig,
} from './types.js'
import { DEFAULT_PAGE_EXTENSIONS } from './types.js'

/**
 * File convention names that use pageExtensions (can be .tsx, .ts, .jsx, .js, .mdx, etc.)
 */
const PAGE_EXT_CONVENTIONS = new Set([
  'page',
  'layout',
  'error',
  'default',
  'denied',
])

/**
 * Legacy compat status-code files.
 * Maps legacy file name → HTTP status code for the fallback chain.
 * See design/10-error-handling.md §"Fallback Chain".
 */
const LEGACY_STATUS_FILES: Record<string, number> = {
  'not-found': 404,
  'forbidden': 403,
  'unauthorized': 401,
}

/**
 * File convention names that are always .ts/.tsx (never .mdx etc.)
 */
const FIXED_CONVENTIONS = new Set(['middleware', 'access', 'route'])

/**
 * Status-code file patterns:
 * - Exact 3-digit codes: 401.tsx, 429.tsx, 503.tsx
 * - Category catch-alls: 4xx.tsx, 5xx.tsx
 */
const STATUS_CODE_PATTERN = /^(\d{3}|[45]xx)$/

/**
 * Scan the app/ directory and build the route tree.
 *
 * @param appDir - Absolute path to the app/ directory
 * @param config - Scanner configuration
 * @returns The complete route tree
 */
export function scanRoutes(appDir: string, config: ScannerConfig = {}): RouteTree {
  const pageExtensions = config.pageExtensions ?? DEFAULT_PAGE_EXTENSIONS
  const extSet = new Set(pageExtensions)

  const tree: RouteTree = {
    root: createSegmentNode('', 'static', '/'),
  }

  // Check for proxy.ts at app root
  const proxyFile = findFixedFile(appDir, 'proxy')
  if (proxyFile) {
    tree.proxy = proxyFile
  }

  // Scan the root directory's files
  scanSegmentFiles(appDir, tree.root, extSet)

  // Scan children recursively
  scanChildren(appDir, tree.root, extSet)

  return tree
}

/**
 * Create an empty segment node.
 */
function createSegmentNode(
  segmentName: string,
  segmentType: SegmentType,
  urlPath: string,
  paramName?: string,
): SegmentNode {
  return {
    segmentName,
    segmentType,
    urlPath,
    paramName,
    children: [],
    slots: new Map(),
  }
}

/**
 * Classify a directory name into its segment type.
 */
export function classifySegment(dirName: string): {
  type: SegmentType
  paramName?: string
} {
  // Parallel route slot: @name
  if (dirName.startsWith('@')) {
    return { type: 'slot' }
  }

  // Route group: (name)
  if (dirName.startsWith('(') && dirName.endsWith(')')) {
    return { type: 'group' }
  }

  // Optional catch-all: [[...name]]
  if (dirName.startsWith('[[...') && dirName.endsWith(']]')) {
    const paramName = dirName.slice(5, -2)
    return { type: 'optional-catch-all', paramName }
  }

  // Catch-all: [...name]
  if (dirName.startsWith('[...') && dirName.endsWith(']')) {
    const paramName = dirName.slice(4, -1)
    return { type: 'catch-all', paramName }
  }

  // Dynamic: [name]
  if (dirName.startsWith('[') && dirName.endsWith(']')) {
    const paramName = dirName.slice(1, -1)
    return { type: 'dynamic', paramName }
  }

  return { type: 'static' }
}

/**
 * Compute the URL path for a child segment given its parent's URL path.
 * Route groups and slots do NOT add URL depth.
 */
function computeUrlPath(parentUrlPath: string, dirName: string, segmentType: SegmentType): string {
  // Groups and slots don't add to URL path
  if (segmentType === 'group' || segmentType === 'slot') {
    return parentUrlPath
  }

  const parentPath = parentUrlPath === '/' ? '' : parentUrlPath
  return `${parentPath}/${dirName}`
}

/**
 * Scan a directory for file conventions and populate the segment node.
 */
function scanSegmentFiles(
  dirPath: string,
  node: SegmentNode,
  extSet: Set<string>,
): void {
  let entries: string[]
  try {
    entries = readdirSync(dirPath)
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry)

    // Skip directories — handled by scanChildren
    try {
      if (statSync(fullPath).isDirectory()) continue
    } catch {
      continue
    }

    const ext = extname(entry).slice(1) // remove leading dot
    const name = basename(entry, `.${ext}`)

    // Page-extension conventions (page, layout, error, default, denied)
    if (PAGE_EXT_CONVENTIONS.has(name) && extSet.has(ext)) {
      const file: RouteFile = { filePath: fullPath, extension: ext }
      switch (name) {
        case 'page':
          node.page = file
          break
        case 'layout':
          node.layout = file
          break
        case 'error':
          node.error = file
          break
        case 'default':
          node.default = file
          break
        case 'denied':
          node.denied = file
          break
      }
      continue
    }

    // Fixed conventions (middleware, access, route) — always .ts or .tsx
    if (FIXED_CONVENTIONS.has(name) && (ext === 'ts' || ext === 'tsx')) {
      const file: RouteFile = { filePath: fullPath, extension: ext }
      switch (name) {
        case 'middleware':
          node.middleware = file
          break
        case 'access':
          node.access = file
          break
        case 'route':
          node.route = file
          break
      }
      continue
    }

    // Status-code files (401.tsx, 4xx.tsx, 503.tsx, 5xx.tsx)
    if (STATUS_CODE_PATTERN.test(name) && extSet.has(ext)) {
      if (!node.statusFiles) {
        node.statusFiles = new Map()
      }
      node.statusFiles.set(name, { filePath: fullPath, extension: ext })
      continue
    }

    // Legacy compat files (not-found.tsx, forbidden.tsx, unauthorized.tsx)
    if (name in LEGACY_STATUS_FILES && extSet.has(ext)) {
      if (!node.legacyStatusFiles) {
        node.legacyStatusFiles = new Map()
      }
      node.legacyStatusFiles.set(name, { filePath: fullPath, extension: ext })
    }
  }

  // Validate: route.ts + page.* is a hard build error
  if (node.route && node.page) {
    throw new Error(
      `Build error: route.ts and page.* cannot coexist in the same segment.\n` +
      `  route.ts: ${node.route.filePath}\n` +
      `  page:     ${node.page.filePath}\n` +
      `A URL is either an API endpoint or a rendered page, not both.`
    )
  }
}

/**
 * Recursively scan child directories and build the segment tree.
 */
function scanChildren(
  dirPath: string,
  parentNode: SegmentNode,
  extSet: Set<string>,
): void {
  let entries: string[]
  try {
    entries = readdirSync(dirPath)
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry)

    try {
      if (!statSync(fullPath).isDirectory()) continue
    } catch {
      continue
    }

    const { type, paramName } = classifySegment(entry)
    const urlPath = computeUrlPath(parentNode.urlPath, entry, type)
    const childNode = createSegmentNode(entry, type, urlPath, paramName)

    // Scan this segment's files
    scanSegmentFiles(fullPath, childNode, extSet)

    // Recurse into subdirectories
    scanChildren(fullPath, childNode, extSet)

    // Attach to parent: slots go into slots map, everything else is a child
    if (type === 'slot') {
      const slotName = entry.slice(1) // remove @
      parentNode.slots.set(slotName, childNode)
    } else {
      parentNode.children.push(childNode)
    }
  }
}

/**
 * Find a fixed-extension file (proxy.ts) in a directory.
 */
function findFixedFile(dirPath: string, name: string): RouteFile | undefined {
  for (const ext of ['ts', 'tsx']) {
    const fullPath = join(dirPath, `${name}.${ext}`)
    try {
      if (statSync(fullPath).isFile()) {
        return { filePath: fullPath, extension: ext }
      }
    } catch {
      // File doesn't exist
    }
  }
  return undefined
}
