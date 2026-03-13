import type { Plugin } from 'vite';
import { Parser } from 'acorn';
import acornJsx from 'acorn-jsx';
import { detectFileDirective } from '../utils/directive-parser.js';

const jsxParser = Parser.extend(acornJsx());

/**
 * Rewrite 'use server' module exports to bypass RSC plugin AST validation.
 *
 * The RSC plugin's client/SSR proxy transform (transformProxyExport) requires
 * all `export const` initializers to be `async ArrowFunctionExpression`. But
 * `createActionClient().action()` and `validated()` return async functions via
 * CallExpressions — valid at runtime but rejected by the static AST check.
 *
 * This plugin rewrites non-function-expression exports from:
 *
 *   export const foo = someCall();
 *
 * to:
 *
 *   const foo = someCall();
 *   export { foo };
 *
 * The `export { name }` form bypasses the RSC plugin's validation without
 * changing runtime semantics. Function expression exports (async arrows,
 * async function expressions) are left untouched.
 *
 * See design/08-forms-and-actions.md §"Middleware for Server Actions"
 */
export function timberServerActionExports(): Plugin {
  return {
    name: 'timber-server-action-exports',
    transform(code, id) {
      // Skip non-JS/TS files
      if (!/\.[jt]sx?$/.test(id)) return;
      // Quick bail-out
      if (!code.includes('use server')) return;
      // Check for file-level directive
      const directive = detectFileDirective(code, ['use server']);
      if (!directive) return;

      return rewriteServerActionExports(code);
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AcornNode = any;

/**
 * Check if an AST node is an async function expression (arrow or regular).
 * These are handled correctly by the RSC plugin and don't need rewriting.
 */
function isAsyncFunctionExpr(node: AcornNode): boolean {
  if (!node) return false;
  return (
    (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') && node.async
  );
}

/**
 * Extract identifier names from a declarator's id pattern.
 * Handles simple identifiers and destructuring patterns.
 */
function extractDeclNames(id: AcornNode): string[] {
  if (id.type === 'Identifier') return [id.name];

  // ObjectPattern: const { a, b } = ...
  if (id.type === 'ObjectPattern') {
    return id.properties.flatMap((p: AcornNode) => extractDeclNames(p.value ?? p.argument));
  }

  // ArrayPattern: const [a, b] = ...
  if (id.type === 'ArrayPattern') {
    return id.elements.filter(Boolean).flatMap((e: AcornNode) => extractDeclNames(e));
  }

  // RestElement: const [...rest] = ...
  if (id.type === 'RestElement') {
    return extractDeclNames(id.argument);
  }

  // AssignmentPattern: const { a = 1 } = ...
  if (id.type === 'AssignmentPattern') {
    return extractDeclNames(id.left);
  }

  return [];
}

interface RewriteTarget {
  /** Start offset of the `export` keyword */
  exportStart: number;
  /** Start offset of the `const/let/var` keyword (right after `export `) */
  declStart: number;
  /** Names to re-export */
  names: string[];
}

function rewriteServerActionExports(code: string): { code: string; map: null } | undefined {
  let ast: AcornNode;
  try {
    ast = jsxParser.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
  } catch {
    // TypeScript that esbuild hasn't stripped yet — use regex fallback
    return rewriteServerActionExportsFallback(code);
  }

  const targets: RewriteTarget[] = [];

  for (const node of ast.body) {
    // Case 1: export const/let/var name = <non-function-expression>
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'VariableDeclaration'
    ) {
      const hasNonFunctionInit = node.declaration.declarations.some(
        (d: AcornNode) => d.init && !isAsyncFunctionExpr(d.init)
      );
      if (!hasNonFunctionInit) continue;

      const names = node.declaration.declarations.flatMap((d: AcornNode) => extractDeclNames(d.id));
      if (names.length === 0) continue;

      targets.push({
        exportStart: node.start,
        declStart: node.declaration.start,
        names,
      });
    }

    // Case 2: export default <non-function-expression>
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      if (
        decl.type !== 'FunctionDeclaration' &&
        decl.type !== 'Identifier' &&
        !isAsyncFunctionExpr(decl)
      ) {
        // export default someCall() → const $$default = someCall(); export default $$default;
        targets.push({
          exportStart: node.start,
          declStart: -1, // sentinel for default export
          names: ['default'],
        });
      }
    }
  }

  if (targets.length === 0) return undefined;

  // Process from end to start to preserve character positions
  let result = code;
  const reExports: string[] = [];

  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];

    if (target.declStart === -1) {
      // export default <expr> → const $$default = <expr>;\nexport default $$default;
      const node = ast.body.find(
        (n: AcornNode) => n.type === 'ExportDefaultDeclaration' && n.start === target.exportStart
      );
      if (node) {
        const exprCode = code.slice(node.declaration.start, node.declaration.end);
        const replacement = `const $$default = ${exprCode};\nexport default $$default;`;
        result = result.slice(0, node.start) + replacement + result.slice(node.end);
      }
      continue;
    }

    // Remove 'export ' from the declaration
    result = result.slice(0, target.exportStart) + result.slice(target.declStart);
    reExports.push(...target.names);
  }

  if (reExports.length > 0) {
    result += '\nexport { ' + reExports.join(', ') + ' };\n';
  }

  return { code: result, map: null };
}

/**
 * Regex fallback for TypeScript files that acorn cannot parse.
 *
 * Matches `export const/let/var name = <expr>` where the initializer does
 * NOT start with `async function` or `async (` (i.e., not an async
 * function expression or async arrow function).
 */
function rewriteServerActionExportsFallback(code: string): { code: string; map: null } | undefined {
  // Match: export const/let/var <name> = <non-async-function-expr>
  const pattern =
    /^(export\s+)((?:const|let|var)\s+(\w+)\s*=\s*)(?!async\s+(?:function[\s(]|\())/gm;

  const names: string[] = [];
  let result = code;
  let offset = 0;
  let match;

  while ((match = pattern.exec(code)) !== null) {
    const exportKeyword = match[1]; // 'export ' (with trailing space)
    const name = match[3];

    // Remove 'export ' at this position (adjusted for prior removals)
    const pos = match.index + offset;
    result = result.slice(0, pos) + result.slice(pos + exportKeyword.length);
    offset -= exportKeyword.length;
    names.push(name);
  }

  if (names.length === 0) return undefined;

  result += '\nexport { ' + names.join(', ') + ' };\n';
  return { code: result, map: null };
}
