/**
 * Route map codegen.
 *
 * Walks the scanned RouteTree and generates a TypeScript declaration file
 * mapping every route to its params and searchParams shapes.
 *
 * This runs at build time and in dev (regenerated on file changes).
 * No runtime overhead — purely static type generation.
 */

import { existsSync } from 'node:fs';
import { join, relative, posix } from 'node:path';
import type { RouteTree, SegmentNode } from './types.js';

/** A single route entry extracted from the segment tree. */
interface RouteEntry {
  /** URL path pattern (e.g. "/products/[id]") */
  urlPath: string;
  /** Accumulated params from all ancestor dynamic segments */
  params: ParamEntry[];
  /** Whether this route has a co-located search-params.ts */
  hasSearchParams: boolean;
  /** Absolute path to search-params.ts (for computing relative import paths) */
  searchParamsAbsPath?: string;
  /** Whether this is an API route (route.ts) vs page route */
  isApiRoute: boolean;
}

interface ParamEntry {
  name: string;
  type: 'string' | 'string[]' | 'string[] | undefined';
}

/** Options for route map generation. */
export interface CodegenOptions {
  /** Absolute path to the app/ directory. Required for search-params.ts detection. */
  appDir?: string;
  /**
   * Absolute path to the directory where the .d.ts file will be written.
   * Used to compute correct relative import paths for search-params.ts files.
   * Defaults to appDir when not provided (preserves backward compat for tests).
   */
  outputDir?: string;
}

/**
 * Generate a TypeScript declaration file string from a scanned route tree.
 *
 * The output is a `declare module '@timber/app'` block containing the Routes
 * interface that maps every route path to its params and searchParams shape.
 */
export function generateRouteMap(tree: RouteTree, options: CodegenOptions = {}): string {
  const routes: RouteEntry[] = [];
  collectRoutes(tree.root, [], options.appDir, routes);

  // Sort routes alphabetically for deterministic output
  routes.sort((a, b) => a.urlPath.localeCompare(b.urlPath));

  // When outputDir differs from appDir, import paths must be relative to outputDir
  const importBase = options.outputDir ?? options.appDir;

  return formatDeclarationFile(routes, importBase);
}

/**
 * Recursively walk the segment tree and collect route entries.
 *
 * A route entry is created for any segment that has a `page` or `route` file.
 * Params accumulate from ancestor dynamic segments.
 */
function collectRoutes(
  node: SegmentNode,
  ancestorParams: ParamEntry[],
  appDir: string | undefined,
  routes: RouteEntry[]
): void {
  // Accumulate params from this segment
  const params = [...ancestorParams];
  if (node.paramName) {
    params.push({
      name: node.paramName,
      type: paramTypeForSegment(node.segmentType),
    });
  }

  // Check if this segment is a leaf route (has page or route file)
  const isPage = !!node.page;
  const isApiRoute = !!node.route;

  if (isPage || isApiRoute) {
    const entry: RouteEntry = {
      urlPath: node.urlPath,
      params: [...params],
      hasSearchParams: false,
      isApiRoute,
    };

    // Detect co-located search-params.ts
    if (appDir && isPage) {
      const segmentDir = resolveSegmentDir(appDir, node);
      const searchParamsFile = findSearchParamsFile(segmentDir);
      if (searchParamsFile) {
        entry.hasSearchParams = true;
        entry.searchParamsAbsPath = searchParamsFile;
      }
    }

    routes.push(entry);
  }

  // Recurse into children
  for (const child of node.children) {
    collectRoutes(child, params, appDir, routes);
  }

  // Recurse into slots (they share the parent's URL path, but may have their own pages)
  for (const [, slot] of node.slots) {
    collectRoutes(slot, params, appDir, routes);
  }
}

/**
 * Determine the TypeScript type for a segment's param.
 */
function paramTypeForSegment(segmentType: string): ParamEntry['type'] {
  switch (segmentType) {
    case 'catch-all':
      return 'string[]';
    case 'optional-catch-all':
      return 'string[] | undefined';
    default:
      return 'string';
  }
}

/**
 * Resolve the absolute directory path for a segment node.
 *
 * Reconstructs the filesystem path by walking from appDir through
 * the segment names encoded in the urlPath, accounting for groups and slots.
 */
function resolveSegmentDir(appDir: string, node: SegmentNode): string {
  // The node's page/route file path gives us the actual directory
  const file = node.page ?? node.route;
  if (file) {
    // The file is in the segment directory — go up one level
    const parts = file.filePath.split('/');
    parts.pop(); // remove filename
    return parts.join('/');
  }
  // Fallback: construct from urlPath (imprecise for groups, but acceptable)
  return appDir;
}

/**
 * Find a search-params.ts file in a directory.
 */
function findSearchParamsFile(dirPath: string): string | undefined {
  for (const ext of ['ts', 'tsx']) {
    const candidate = join(dirPath, `search-params.${ext}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Format the collected routes into a TypeScript declaration file.
 */
function formatDeclarationFile(routes: RouteEntry[], importBase?: string): string {
  const lines: string[] = [];

  lines.push('// This file is auto-generated by timber.js route map codegen.');
  lines.push('// Do not edit manually. Regenerated on build and in dev mode.');
  lines.push('');
  // export {} makes this file a module, so all declare module blocks are
  // augmentations rather than ambient replacements. Without this, the
  // declare module blocks would replace the original module types entirely
  // (removing exports like bindUseQueryStates that aren't listed here).
  lines.push('export {};');
  lines.push('');
  lines.push("declare module '@timber/app' {");
  lines.push('  interface Routes {');

  for (const route of routes) {
    const paramsType = formatParamsType(route.params);
    const searchParamsType = formatSearchParamsType(route, importBase);

    lines.push(`    '${route.urlPath}': {`);
    lines.push(`      params: ${paramsType}`);
    lines.push(`      searchParams: ${searchParamsType}`);
    lines.push(`    }`);
  }

  lines.push('  }');
  lines.push('}');
  lines.push('');

  // Generate @timber/app/server augmentation — typed searchParams() generic
  const pageRoutes = routes.filter((r) => !r.isApiRoute);

  if (pageRoutes.length > 0) {
    lines.push("declare module '@timber/app/server' {");
    lines.push("  import type { Routes } from '@timber/app'");
    lines.push(
      "  export function searchParams<R extends keyof Routes>(): Promise<Routes[R]['searchParams']>"
    );
    lines.push('}');
    lines.push('');
  }

  // Generate overloads for @timber/app/client
  const dynamicRoutes = routes.filter((r) => r.params.length > 0);

  if (dynamicRoutes.length > 0 || pageRoutes.length > 0) {
    lines.push("declare module '@timber/app/client' {");
    lines.push(
      "  import type { SearchParamsDefinition, SetParams, QueryStatesOptions, SearchParamCodec } from '@timber/app/search-params'"
    );
    lines.push('');

    // useParams overloads
    if (dynamicRoutes.length > 0) {
      for (const route of dynamicRoutes) {
        const paramsType = formatParamsType(route.params);
        lines.push(`  export function useParams(route: '${route.urlPath}'): ${paramsType}`);
      }
      lines.push('  export function useParams(): Record<string, string | string[]>');
      lines.push('');
    }

    // useQueryStates overloads
    if (pageRoutes.length > 0) {
      lines.push(...formatUseQueryStatesOverloads(pageRoutes, importBase));
      lines.push('');
    }

    // Typed Link overloads
    if (pageRoutes.length > 0) {
      lines.push('  // Typed Link props per route');
      lines.push(...formatTypedLinkOverloads(pageRoutes, importBase));
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format the params type for a route entry.
 */
function formatParamsType(params: ParamEntry[]): string {
  if (params.length === 0) {
    return '{}';
  }

  const fields = params.map((p) => `${p.name}: ${p.type}`);
  return `{ ${fields.join('; ')} }`;
}

/**
 * Format the params type for Link props.
 *
 * Link params accept `string | number` for single dynamic segments
 * (convenience — values are stringified at runtime). Catch-all and
 * optional catch-all remain `string[]` / `string[] | undefined`.
 *
 * See design/07-routing.md §"Typed params and searchParams on <Link>"
 */
function formatLinkParamsType(params: ParamEntry[]): string {
  if (params.length === 0) {
    return '{}';
  }

  const fields = params.map((p) => {
    // Single dynamic segments accept string | number for convenience
    const type = p.type === 'string' ? 'string | number' : p.type;
    return `${p.name}: ${type}`;
  });
  return `{ ${fields.join('; ')} }`;
}

/**
 * Format the searchParams type for a route entry.
 *
 * When a search-params.ts exists, we reference its inferred type via an import type.
 * The import path is relative to `importBase` (the directory where the .d.ts will be
 * written). When importBase is undefined, falls back to a bare relative path.
 */
function formatSearchParamsType(route: RouteEntry, importBase?: string): string {
  if (route.hasSearchParams && route.searchParamsAbsPath) {
    const absPath = route.searchParamsAbsPath.replace(/\.(ts|tsx)$/, '');
    let importPath: string;
    if (importBase) {
      // Make the path relative to the output directory, converted to posix separators
      importPath = './' + relative(importBase, absPath).replace(/\\/g, '/');
    } else {
      importPath = './' + posix.basename(absPath);
    }
    // Use (typeof import('...'))[' default'] instead of import('...').default
    // because with moduleResolution:"bundler", import('...').default is treated as
    // a namespace member access which doesn't work for default exports.
    return `(typeof import('${importPath}'))['default'] extends import('@timber/app/search-params').SearchParamsDefinition<infer T> ? T : never`;
  }
  return '{}';
}

/**
 * Generate useQueryStates overloads.
 *
 * For each page route:
 * - Routes with search-params.ts get a typed overload returning the inferred T
 * - Routes without search-params.ts get an overload returning [{}, SetParams<{}>]
 *
 * A fallback overload for standalone codecs (existing API) is emitted last.
 */
function formatUseQueryStatesOverloads(routes: RouteEntry[], importBase?: string): string[] {
  const lines: string[] = [];

  for (const route of routes) {
    const searchParamsType = route.hasSearchParams
      ? formatSearchParamsType(route, importBase)
      : '{}';
    lines.push(
      `  export function useQueryStates<R extends '${route.urlPath}'>(route: R, options?: QueryStatesOptions): [${searchParamsType}, SetParams<${searchParamsType}>]`
    );
  }

  // Fallback: standalone codecs (existing API)
  lines.push(
    '  export function useQueryStates<T extends Record<string, unknown>>(codecs: { [K in keyof T]: SearchParamCodec<T[K]> }, options?: QueryStatesOptions): [T, SetParams<T>]'
  );

  return lines;
}

/**
 * Generate typed Link overloads.
 *
 * For each page route, we generate a Link function overload that:
 * - Constrains href to the route pattern
 * - Types the params prop based on dynamic segments
 * - Types the searchParams prop based on search-params.ts (if present)
 *
 * Routes without dynamic segments accept href as a literal string with no params.
 * Routes with dynamic segments require a params prop.
 */
function formatTypedLinkOverloads(routes: RouteEntry[], importBase?: string): string[] {
  const lines: string[] = [];

  for (const route of routes) {
    const hasDynamicParams = route.params.length > 0;
    const paramsType = formatLinkParamsType(route.params);
    const searchParamsType = route.hasSearchParams
      ? formatSearchParamsType(route, importBase)
      : null;

    if (hasDynamicParams) {
      // Route with dynamic segments — params prop required
      const spProp = searchParamsType
        ? `searchParams?: { definition: SearchParamsDefinition<${searchParamsType}>; values: Partial<${searchParamsType}> }`
        : `searchParams?: never`;
      lines.push(
        `  export function Link(props: Omit<import('react').AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {`
      );
      lines.push(`    href: '${route.urlPath}'`);
      lines.push(`    params: ${paramsType}`);
      lines.push(`    ${spProp}`);
      lines.push(`    prefetch?: boolean; scroll?: boolean; children?: import('react').ReactNode`);
      lines.push(`  }): import('react').JSX.Element`);
    } else {
      // Static route — no params needed
      const spProp = searchParamsType
        ? `searchParams?: { definition: SearchParamsDefinition<${searchParamsType}>; values: Partial<${searchParamsType}> }`
        : `searchParams?: never`;
      lines.push(
        `  export function Link(props: Omit<import('react').AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {`
      );
      lines.push(`    href: '${route.urlPath}'`);
      lines.push(`    params?: never`);
      lines.push(`    ${spProp}`);
      lines.push(`    prefetch?: boolean; scroll?: boolean; children?: import('react').ReactNode`);
      lines.push(`  }): import('react').JSX.Element`);
    }
  }

  // Fallback overload for arbitrary string hrefs (escape hatch)
  lines.push(
    `  export function Link(props: import('./client/link.js').LinkProps): import('react').JSX.Element`
  );

  return lines;
}
