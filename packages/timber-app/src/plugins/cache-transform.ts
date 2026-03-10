import type { Plugin } from 'vite';

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

interface TransformResult {
  code: string;
  map?: null;
}

/**
 * Match a 'use cache' or "use cache" directive as the first statement in a function body.
 * This regex finds function declarations and arrow functions that contain the directive.
 */
const USE_CACHE_PATTERN = /['"]use cache['"]/;

/**
 * Match cacheLife() calls: cacheLife('1h'), cacheLife("5m"), cacheLife(300)
 */
const CACHE_LIFE_PATTERN = /cacheLife\(\s*(?:'([^']+)'|"([^"]+)"|(\d+))\s*\)/;

interface FunctionInfo {
  name: string;
  fullMatch: string;
  startIndex: number;
  endIndex: number;
  bodyStart: number;
  bodyEnd: number;
  bodyContent: string;
  prefix: string; // 'export ', 'export default ', or ''
  isArrow: boolean;
  declaration: string; // The function signature without the body
}

/**
 * Find all function declarations and arrow function assignments in code,
 * returning those that contain 'use cache' directive.
 */
function findCachedFunctions(code: string): FunctionInfo[] {
  const results: FunctionInfo[] = [];

  // Strategy: Find 'use cache' directives, then walk backwards to find the owning function.
  // We work with a character-level scan to handle nested braces correctly.

  // Pattern 1: named function declarations
  const fnDeclPattern =
    /(?:(export\s+default\s+|export\s+))?async\s+function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = fnDeclPattern.exec(code)) !== null) {
    const prefix = match[1]?.trim() || '';
    const name = match[2];
    const bodyStart = match.index + match[0].length; // char after '{'
    const bodyEnd = findMatchingBrace(code, bodyStart - 1);
    if (bodyEnd === -1) continue;

    const bodyContent = code.slice(bodyStart, bodyEnd);
    if (!USE_CACHE_PATTERN.test(bodyContent)) continue;

    results.push({
      name,
      fullMatch: code.slice(match.index, bodyEnd + 1),
      startIndex: match.index,
      endIndex: bodyEnd + 1,
      bodyStart,
      bodyEnd,
      bodyContent,
      prefix: prefix ? prefix + ' ' : '',
      isArrow: false,
      declaration: match[0].slice(0, -1).trim(), // Remove the trailing '{'
    });
  }

  // Pattern 2: arrow functions
  const arrowPattern = /(?:const|let|var)\s+(\w+)\s*=\s*async\s*(\([^)]*\)|[^=]*?)\s*=>\s*\{/g;
  while ((match = arrowPattern.exec(code)) !== null) {
    const name = match[1];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMatchingBrace(code, bodyStart - 1);
    if (bodyEnd === -1) continue;

    const bodyContent = code.slice(bodyStart, bodyEnd);
    if (!USE_CACHE_PATTERN.test(bodyContent)) continue;

    results.push({
      name,
      fullMatch: code.slice(match.index, bodyEnd + 1),
      startIndex: match.index,
      endIndex: bodyEnd + 1,
      bodyStart,
      bodyEnd,
      bodyContent,
      prefix: '',
      isArrow: true,
      declaration: match[0].slice(0, -1).trim(),
    });
  }

  // Sort by position (descending) so we can replace from end to start without shifting indices
  results.sort((a, b) => b.startIndex - a.startIndex);
  return results;
}

/**
 * Find the matching closing brace for a given opening brace position.
 * Handles nested braces, strings, template literals, and comments.
 */
function findMatchingBrace(code: string, openPos: number): number {
  let depth = 1;
  let i = openPos + 1;

  while (i < code.length && depth > 0) {
    const ch = code[i];

    // Skip string literals
    if (ch === "'" || ch === '"') {
      i = skipString(code, i);
      continue;
    }

    // Skip template literals
    if (ch === '`') {
      i = skipTemplateLiteral(code, i);
      continue;
    }

    // Skip line comments
    if (ch === '/' && code[i + 1] === '/') {
      i = code.indexOf('\n', i);
      if (i === -1) return -1;
      i++;
      continue;
    }

    // Skip block comments
    if (ch === '/' && code[i + 1] === '*') {
      i = code.indexOf('*/', i + 2);
      if (i === -1) return -1;
      i += 2;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

function skipString(code: string, start: number): number {
  const quote = code[start];
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2;
      continue;
    }
    if (code[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function skipTemplateLiteral(code: string, start: number): number {
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2;
      continue;
    }
    if (code[i] === '`') return i + 1;
    if (code[i] === '$' && code[i + 1] === '{') {
      // Skip template expression — find matching }
      i = findMatchingBrace(code, i + 1) + 1;
      continue;
    }
    i++;
  }
  return i;
}

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
 * Transform source code containing 'use cache' directives into
 * registerCachedFunction() calls.
 *
 * Returns null if no transformations were made.
 */
export function transformUseCache(code: string, fileId: string): TransformResult | null {
  if (!USE_CACHE_PATTERN.test(code)) return null;

  const functions = findCachedFunctions(code);
  if (functions.length === 0) return null;

  let result = code;
  let needsImport = false;

  // Process functions from end to start (sorted descending by startIndex)
  for (const fn of functions) {
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
      // We need to reconstruct the arrow function inside registerCachedFunction
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

    result = result.slice(0, fn.startIndex) + replacement + result.slice(fn.endIndex);
    needsImport = true;
  }

  if (needsImport) {
    // Add the import at the top of the file
    result = `import { registerCachedFunction } from '@timber/app/cache';\n` + result;
  }

  return { code: result, map: null };
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
      if (!USE_CACHE_PATTERN.test(code)) return null;

      return transformUseCache(code, id);
    },
  };
}
