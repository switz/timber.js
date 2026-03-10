/**
 * AST-based directive detection for 'use cache', 'use dynamic',
 * 'use client', and 'use server'.
 *
 * Uses acorn to parse source code and detect directives properly,
 * avoiding false positives from regex matching inside string literals,
 * comments, or template expressions.
 *
 * @module
 */

import { Parser } from 'acorn';
import acornJsx from 'acorn-jsx';

// acorn parser with JSX support
const jsxParser = Parser.extend(acornJsx());

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileDirective {
  /** The directive value, e.g. 'use client', 'use server' */
  directive: string;
  /** 1-based line number where the directive appears */
  line: number;
}

export interface FunctionWithDirective {
  /** Function name (or 'default' for anonymous default exports) */
  name: string;
  /** The directive found in the function body */
  directive: string;
  /** 1-based line number of the directive */
  directiveLine: number;
  /** Start offset of the function in the source */
  start: number;
  /** End offset of the function in the source */
  end: number;
  /** Start offset of the function body block (after the '{') */
  bodyStart: number;
  /** End offset of the function body block (the '}') */
  bodyEnd: number;
  /** Content between { and } of the function body */
  bodyContent: string;
  /** 'export ', 'export default ', or '' */
  prefix: string;
  /** Whether this is an arrow function */
  isArrow: boolean;
  /** The function signature (everything before the body '{') */
  declaration: string;
}

// ---------------------------------------------------------------------------
// File-level directive detection
// ---------------------------------------------------------------------------

/**
 * Detect a file-level directive ('use client', 'use server', etc.).
 *
 * Per the ECMAScript spec, directives are string literal expression
 * statements at the start of a program body (before any non-directive
 * statements). This function checks the AST `Program.body` for
 * `ExpressionStatement` nodes whose expression is a `Literal` string
 * matching a known directive.
 *
 * Returns the first matching directive, or null if none found.
 */
export function detectFileDirective(
  code: string,
  directives: string[] = ['use client', 'use server']
): FileDirective | null {
  let ast: any;
  try {
    ast = jsxParser.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
  } catch {
    // If the file fails to parse (e.g. TypeScript syntax), fall back to
    // a safe line-by-line check that only considers lines before any
    // non-comment, non-whitespace, non-directive content.
    return detectFileDirectiveFallback(code, directives);
  }

  for (const node of ast.body) {
    if (
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'Literal' &&
      typeof node.expression.value === 'string'
    ) {
      if (directives.includes(node.expression.value)) {
        return {
          directive: node.expression.value,
          line: node.loc.start.line,
        };
      }
    } else {
      // Directives must appear before any non-directive statements
      break;
    }
  }

  return null;
}

/**
 * Fallback for TypeScript files that acorn cannot parse.
 *
 * Scans lines from the top of the file. Skips blank lines and comments.
 * Checks if the first real statement is a directive string literal.
 */
function detectFileDirectiveFallback(
  code: string,
  directives: string[]
): FileDirective | null {
  const lines = code.split('\n');
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Handle block comments
    if (inBlockComment) {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) continue;
      line = line.slice(endIdx + 2).trim();
      inBlockComment = false;
      if (!line) continue;
    }

    // Skip blank lines
    if (!line) continue;

    // Skip line comments
    if (line.startsWith('//')) continue;

    // Skip block comment start
    if (line.startsWith('/*')) {
      const endIdx = line.indexOf('*/', 2);
      if (endIdx === -1) {
        inBlockComment = true;
        continue;
      }
      line = line.slice(endIdx + 2).trim();
      if (!line) continue;
    }

    // Check for directive
    for (const dir of directives) {
      // Match 'directive' or "directive" optionally followed by ;
      if (
        line === `'${dir}'` ||
        line === `'${dir}';` ||
        line === `"${dir}"` ||
        line === `"${dir}";`
      ) {
        return { directive: dir, line: i + 1 };
      }
    }

    // First non-comment, non-blank line is not a directive — stop
    break;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Function-body directive detection
// ---------------------------------------------------------------------------

/**
 * Find all functions in the source code that contain a directive
 * (e.g. 'use cache', 'use dynamic') as their first body statement.
 *
 * Parses the source with acorn and walks the AST looking for function
 * declarations and arrow function expressions whose body is a
 * BlockStatement with a directive prologue.
 *
 * Returns an array of function info objects, sorted by position
 * (descending) for safe end-to-start replacement.
 */
export function findFunctionsWithDirective(
  code: string,
  directive: string
): FunctionWithDirective[] {
  let ast: any;
  try {
    ast = jsxParser.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
  } catch {
    // TypeScript fallback: return empty — callers should use the quick
    // regex check first and skip non-matching files anyway
    return findFunctionsWithDirectiveFallback(code, directive);
  }

  const results: FunctionWithDirective[] = [];
  walkAst(ast, code, directive, results, []);

  // Sort descending by start position for safe end-to-start replacement
  results.sort((a, b) => b.start - a.start);
  return results;
}

/**
 * Recursive AST walker that finds functions with a directive in their body.
 */
function walkAst(
  node: any,
  code: string,
  directive: string,
  results: FunctionWithDirective[],
  ancestors: any[]
): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const child of node) {
      walkAst(child, code, directive, results, ancestors);
    }
    return;
  }

  if (!node.type) return;

  // Check function declarations and expressions
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression'
  ) {
    checkFunctionBody(node, code, directive, results, ancestors);
  }

  // Check arrow functions with block bodies
  if (
    node.type === 'ArrowFunctionExpression' &&
    node.body &&
    node.body.type === 'BlockStatement'
  ) {
    checkFunctionBody(node, code, directive, results, ancestors);
  }

  // Walk children
  const newAncestors = [...ancestors, node];
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
    const child = node[key];
    if (child && typeof child === 'object') {
      walkAst(child, code, directive, results, newAncestors);
    }
  }
}

/**
 * Check if a function's body starts with the target directive.
 */
function checkFunctionBody(
  node: any,
  code: string,
  directive: string,
  results: FunctionWithDirective[],
  ancestors: any[]
): void {
  const body =
    node.type === 'ArrowFunctionExpression' ? node.body : node.body;
  if (!body || body.type !== 'BlockStatement' || body.body.length === 0) return;

  // Check the first statement for a directive
  const firstStmt = body.body[0];
  if (
    firstStmt.type !== 'ExpressionStatement' ||
    firstStmt.expression.type !== 'Literal' ||
    firstStmt.expression.value !== directive
  ) {
    return;
  }

  // Determine function metadata from AST context
  const parent = ancestors[ancestors.length - 1];
  const grandparent = ancestors.length >= 2 ? ancestors[ancestors.length - 2] : null;

  let name = '';
  let prefix = '';
  let isArrow = node.type === 'ArrowFunctionExpression';
  let funcStart = node.start;
  let funcEnd = node.end;

  if (node.type === 'FunctionDeclaration') {
    name = node.id?.name || 'default';

    // Check for export
    if (parent?.type === 'ExportNamedDeclaration') {
      prefix = 'export ';
      funcStart = parent.start;
      funcEnd = parent.end;
    } else if (parent?.type === 'ExportDefaultDeclaration') {
      prefix = 'export default ';
      funcStart = parent.start;
      funcEnd = parent.end;
    }
  } else if (node.type === 'ArrowFunctionExpression') {
    // Arrow in variable declaration: const name = async () => {}
    if (parent?.type === 'VariableDeclarator' && parent.id?.name) {
      name = parent.id.name;
      // Include the full variable declaration
      if (grandparent?.type === 'VariableDeclaration') {
        funcStart = grandparent.start;
        funcEnd = grandparent.end;
      }
    }
  } else if (node.type === 'FunctionExpression') {
    // Function expression in variable: const name = async function() {}
    name = node.id?.name || '';
    if (parent?.type === 'VariableDeclarator' && parent.id?.name) {
      name = parent.id.name;
      if (grandparent?.type === 'VariableDeclaration') {
        funcStart = grandparent.start;
        funcEnd = grandparent.end;
      }
    }
  }

  if (!name) return; // Skip anonymous functions we can't name

  // Extract the body content (between the braces)
  const bodyStart = body.start + 1; // after '{'
  const bodyEnd = body.end - 1; // before '}'
  const bodyContent = code.slice(bodyStart, bodyEnd);

  // Extract declaration (everything before the body '{')
  const declaration = code.slice(funcStart, body.start).trim();

  results.push({
    name,
    directive,
    directiveLine: firstStmt.loc.start.line,
    start: funcStart,
    end: funcEnd,
    bodyStart,
    bodyEnd,
    bodyContent,
    prefix,
    isArrow,
    declaration,
  });
}

// ---------------------------------------------------------------------------
// TypeScript fallback for function-body directives
// ---------------------------------------------------------------------------

/**
 * Fallback that uses regex to find functions with directives when acorn
 * cannot parse the file (TypeScript with type annotations).
 *
 * This is less precise but handles common patterns. The regex approach
 * is only used as a fallback — pure JS/JSX files always use the AST path.
 */
function findFunctionsWithDirectiveFallback(
  code: string,
  directive: string
): FunctionWithDirective[] {
  const results: FunctionWithDirective[] = [];
  const directivePattern = new RegExp(`['"]${escapeRegex(directive)}['"]`);

  // Quick bail-out
  if (!directivePattern.test(code)) return results;

  // Pattern 1: function declarations
  const fnDeclPattern =
    /(?:(export\s+default\s+|export\s+))?async\s+function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = fnDeclPattern.exec(code)) !== null) {
    const prefix = match[1]?.trim() || '';
    const name = match[2];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMatchingBraceFallback(code, bodyStart - 1);
    if (bodyEnd === -1) continue;

    const bodyContent = code.slice(bodyStart, bodyEnd);
    // Check that the directive is the first meaningful statement
    const trimmedBody = bodyContent.trimStart();
    if (!trimmedBody.startsWith(`'${directive}'`) && !trimmedBody.startsWith(`"${directive}"`)) continue;

    const directiveLine = code.slice(0, bodyStart).split('\n').length +
      bodyContent.slice(0, bodyContent.indexOf(directive)).split('\n').length - 1;

    results.push({
      name,
      directive,
      directiveLine,
      start: match.index,
      end: bodyEnd + 1,
      bodyStart,
      bodyEnd,
      bodyContent,
      prefix: prefix ? prefix + ' ' : '',
      isArrow: false,
      declaration: code.slice(match.index, bodyStart - 1).trimEnd(),
    });
  }

  // Pattern 2: arrow functions
  const arrowPattern = /(?:const|let|var)\s+(\w+)\s*=\s*async\s*(\([^)]*\)|[^=]*?)\s*=>\s*\{/g;
  while ((match = arrowPattern.exec(code)) !== null) {
    const name = match[1];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMatchingBraceFallback(code, bodyStart - 1);
    if (bodyEnd === -1) continue;

    const bodyContent = code.slice(bodyStart, bodyEnd);
    const trimmedBody = bodyContent.trimStart();
    if (!trimmedBody.startsWith(`'${directive}'`) && !trimmedBody.startsWith(`"${directive}"`)) continue;

    const directiveLine = code.slice(0, bodyStart).split('\n').length +
      bodyContent.slice(0, bodyContent.indexOf(directive)).split('\n').length - 1;

    results.push({
      name,
      directive,
      directiveLine,
      start: match.index,
      end: bodyEnd + 1,
      bodyStart,
      bodyEnd,
      bodyContent,
      prefix: '',
      isArrow: true,
      declaration: code.slice(match.index, bodyStart - 1).trimEnd(),
    });
  }

  results.sort((a, b) => b.start - a.start);
  return results;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find matching closing brace — same algorithm as cache-transform.ts
 * but kept here for the fallback path only.
 */
function findMatchingBraceFallback(code: string, openPos: number): number {
  let depth = 1;
  let i = openPos + 1;

  while (i < code.length && depth > 0) {
    const ch = code[i];

    if (ch === "'" || ch === '"') {
      i = skipStringFallback(code, i);
      continue;
    }
    if (ch === '`') {
      i = skipTemplateFallback(code, i);
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      i = code.indexOf('\n', i);
      if (i === -1) return -1;
      i++;
      continue;
    }
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

function skipStringFallback(code: string, start: number): number {
  const quote = code[start];
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue; }
    if (code[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function skipTemplateFallback(code: string, start: number): number {
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue; }
    if (code[i] === '`') return i + 1;
    if (code[i] === '$' && code[i + 1] === '{') {
      i = findMatchingBraceFallback(code, i + 1) + 1;
      continue;
    }
    i++;
  }
  return i;
}

// ---------------------------------------------------------------------------
// Convenience: quick regex check (for fast bail-out before AST parsing)
// ---------------------------------------------------------------------------

/**
 * Quick regex check for whether code contains a directive string.
 * Use as a fast bail-out before calling the AST-based functions.
 */
export function containsDirective(code: string, directive: string): boolean {
  return code.includes(directive);
}
