import type { Plugin } from 'vite';
import { findFunctionsWithDirective, containsDirective } from '#/utils/directive-parser.js';

/**
 * Parse a cacheLife duration string to seconds.
 * Supports: '30s', '5m', '1h', '2d', '1w', or a plain number (seconds).
 */
export function parseCacheLife(value: string | number): number {
  if (typeof value === 'number') return value;

  const match = value.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) {
    throw new Error(
      `Invalid cacheLife value: "${value}". Expected format: "30s", "5m", "1h", "2d", "1w", or a number.`
    );
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return amount * multipliers[unit];
}

// Default TTL when no cacheLife() is specified (Infinity means cache until explicit invalidation).
const DEFAULT_TTL = Infinity;

export interface CacheTransformWarning {
  message: string;
  functionName: string;
}

interface TransformResult {
  code: string;
  map?: null;
  warnings?: CacheTransformWarning[];
}

/**
 * Match cacheLife() calls: cacheLife('1h'), cacheLife("5m"), cacheLife(300)
 */
const CACHE_LIFE_PATTERN = /cacheLife\(\s*(?:'([^']+)'|"([^"]+)"|(\d+))\s*\)/;

/**
 * Strip the 'use cache' directive and cacheLife() call from a function body.
 * Returns the cleaned body and the extracted TTL.
 */
function extractCacheDirectives(body: string): { cleanBody: string; ttl: number } {
  let ttl = DEFAULT_TTL;

  // Remove 'use cache' / "use cache" directive (including optional semicolon and newline)
  let cleanBody = body.replace(/\s*['"]use cache['"];?\s*\n?/, '\n');

  // Extract and remove cacheLife() calls
  const lifeMatch = cleanBody.match(CACHE_LIFE_PATTERN);
  if (lifeMatch) {
    const value = lifeMatch[1] || lifeMatch[2] || parseInt(lifeMatch[3], 10);
    ttl = parseCacheLife(value);
    cleanBody = cleanBody.replace(/\s*cacheLife\([^)]*\);?\s*\n?/, '\n');
  }

  return { cleanBody, ttl };
}

/**
 * Determine if a function name is a React component (PascalCase).
 */
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * Pattern matching page/layout file conventions in a dynamic route segment.
 * Matches paths like: app/[slug]/page.tsx, app/[id]/layout.ts, etc.
 */
const DYNAMIC_ROUTE_PAGE_PATTERN = /\/\[[^\]]+\].*\/(page|layout)\.[jt]sx?$/;

/**
 * Detect if a function declaration has Promise-typed parameters.
 *
 * Checks for common patterns:
 * - `params: Promise<...>`
 * - `{ params }: { params: Promise<...> }`
 * - `props: { params: Promise<...> }`
 */
const PROMISE_PARAMS_PATTERN = /params\s*(?::|.*?:)\s*Promise\s*</;

/**
 * Check if a 'use cache' function in a dynamic route page/layout receives
 * Promise-typed params, which are not serializable as cache keys.
 */
export function detectPromiseParamsWarning(
  declaration: string,
  functionName: string,
  fileId: string
): CacheTransformWarning | null {
  if (!DYNAMIC_ROUTE_PAGE_PATTERN.test(fileId)) return null;
  if (!PROMISE_PARAMS_PATTERN.test(declaration)) return null;

  return {
    message:
      `'use cache' on "${functionName}" in "${fileId}" receives Promise params. ` +
      `Promise is not serializable as a cache key and will cause runtime errors. ` +
      `Either remove 'use cache' or await the params before using them in a separate cached function.`,
    functionName,
  };
}

/**
 * Transform source code containing 'use cache' directives into
 * registerCachedFunction() calls.
 *
 * Returns null if no transformations were made.
 */
export function transformUseCache(code: string, fileId: string): TransformResult | null {
  if (!containsDirective(code, 'use cache')) return null;

  const functions = findFunctionsWithDirective(code, 'use cache');
  if (functions.length === 0) return null;

  let result = code;
  let needsImport = false;
  const warnings: CacheTransformWarning[] = [];

  // Process functions from end to start (sorted descending by start position)
  for (const fn of functions) {
    // Warn if function receives Promise params in a dynamic route page/layout
    const promiseWarning = detectPromiseParamsWarning(fn.declaration, fn.name, fileId);
    if (promiseWarning) warnings.push(promiseWarning);
    const { cleanBody, ttl } = extractCacheDirectives(fn.bodyContent);
    const stableId = `${fileId}#${fn.name}`;
    const isComponent = isComponentName(fn.name);

    // Build the options object
    const optsParts = [`ttl: ${ttl === Infinity ? 'Infinity' : ttl}`];
    optsParts.push(`id: '${stableId}'`);
    if (isComponent) {
      optsParts.push('isComponent: true');
    }
    const optsStr = `{ ${optsParts.join(', ')} }`;

    // Build the replacement
    let replacement: string;
    if (fn.isArrow) {
      // const Name = async (...) => { body } → const Name = registerCachedFunction(async (...) => { body }, opts)
      const arrowSig = fn.declaration.replace(/^(?:const|let|var)\s+\w+\s*=\s*/, '');
      replacement = `const ${fn.name} = registerCachedFunction(${arrowSig} {${cleanBody}}, ${optsStr})`;
    } else {
      // async function Name(...) { body } → const Name = registerCachedFunction(async function Name(...) { body }, opts)
      const fnDecl = fn.declaration.replace(/^(?:export\s+default\s+|export\s+)?/, '');
      const exportPrefix = fn.prefix.includes('default')
        ? 'export default '
        : fn.prefix.includes('export')
          ? 'export '
          : '';

      replacement = `${exportPrefix}const ${fn.name} = registerCachedFunction(${fnDecl} {${cleanBody}}, ${optsStr})`;
    }

    result = result.slice(0, fn.start) + replacement + result.slice(fn.end);
    needsImport = true;
  }

  if (needsImport) {
    // Add the import at the top of the file
    result = `import { registerCachedFunction } from '@timber-js/app/cache';\n` + result;
  }

  return { code: result, map: null, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Vite plugin: timber-cache
 *
 * Transforms 'use cache' directives into registerCachedFunction() calls.
 * Only runs in the RSC environment.
 */
export function cacheTransformPlugin(): Plugin {
  return {
    name: 'timber-cache',

    transform(code, id) {
      // Only transform in RSC environment
      // Skip node_modules and non-JS/TS files
      if (id.includes('node_modules')) return null;
      if (!/\.[jt]sx?$/.test(id)) return null;

      // Quick bail-out: no 'use cache' directive in this file
      if (!containsDirective(code, 'use cache')) return null;

      const result = transformUseCache(code, id);
      if (result?.warnings) {
        for (const w of result.warnings) {
          this.warn(`[timber] ${w.message}`);
        }
      }
      return result;
    },
  };
}
