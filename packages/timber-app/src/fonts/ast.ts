/**
 * Acorn-based AST utilities for extracting static font configs from source code.
 *
 * Replaces the fragile regex-based extraction in fonts.ts and local.ts.
 * Uses acorn (already a Vite dependency) for robust parsing that handles
 * comments, trailing commas, multi-line configs, and other edge cases
 * the regex approach missed.
 *
 * Design doc: 24-fonts.md §"Step 1: Static Analysis"
 */

import { parse } from 'acorn';
import type { GoogleFontConfig } from './types.js';
import type { LocalFontConfig, LocalFontSrc } from './types.js';

// ── AST node types (minimal subset of estree) ────────────────────────────────

interface AstNode {
  type: string;
  [key: string]: unknown;
}

interface LiteralNode extends AstNode {
  type: 'Literal';
  value: string | number | boolean | null;
}

interface ArrayExpressionNode extends AstNode {
  type: 'ArrayExpression';
  elements: AstNode[];
}

interface ObjectExpressionNode extends AstNode {
  type: 'ObjectExpression';
  properties: PropertyNode[];
}

interface PropertyNode extends AstNode {
  type: 'Property';
  key: AstNode & { name?: string; value?: string | number };
  value: AstNode;
}

interface IdentifierNode extends AstNode {
  type: 'Identifier';
  name: string;
}

// ── Core AST extraction helpers ──────────────────────────────────────────────

/**
 * Parse a JavaScript expression string into an AST node.
 *
 * Wraps the expression in parens so acorn treats it as an expression statement.
 * Returns null if parsing fails.
 */
function parseExpression(source: string): AstNode | null {
  try {
    const ast = parse(`(${source})`, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    }) as unknown as { body: Array<{ expression: AstNode }> };
    return ast.body[0]?.expression ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract a static string value from an AST node.
 * Returns undefined if the node is not a string literal.
 */
function extractString(node: AstNode): string | undefined {
  if (node.type === 'Literal' && typeof (node as LiteralNode).value === 'string') {
    return (node as LiteralNode).value as string;
  }
  return undefined;
}

/**
 * Extract a static boolean value from an AST node.
 * Returns undefined if the node is not a boolean literal.
 */
function extractBoolean(node: AstNode): boolean | undefined {
  if (node.type === 'Literal' && typeof (node as LiteralNode).value === 'boolean') {
    return (node as LiteralNode).value as boolean;
  }
  return undefined;
}

/**
 * Extract a string array from an AST ArrayExpression node.
 * Returns undefined if any element is not a string literal.
 */
function extractStringArray(node: AstNode): string[] | undefined {
  if (node.type !== 'ArrayExpression') return undefined;
  const arr = node as ArrayExpressionNode;
  const result: string[] = [];
  for (const elem of arr.elements) {
    const s = extractString(elem);
    if (s === undefined) return undefined;
    result.push(s);
  }
  return result;
}

/**
 * Get the key name from a Property node.
 */
function getPropertyKey(prop: PropertyNode): string | undefined {
  if (prop.key.type === 'Identifier') {
    return (prop.key as IdentifierNode).name;
  }
  if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
    return prop.key.value;
  }
  return undefined;
}

/**
 * Build a map of property name → value node from an ObjectExpression.
 */
function objectProperties(node: ObjectExpressionNode): Map<string, AstNode> {
  const map = new Map<string, AstNode>();
  for (const prop of node.properties) {
    // Skip spread elements or computed keys
    if (prop.type !== 'Property') continue;
    const key = getPropertyKey(prop);
    if (key) map.set(key, prop.value);
  }
  return map;
}

// ── Google font config extraction ────────────────────────────────────────────

/**
 * Extract a GoogleFontConfig from the source text of a font function call's
 * object argument.
 *
 * The `callSource` should be the text of the call's argument list including
 * parens, e.g. `({ subsets: ['latin'], weight: '400' })`.
 *
 * Returns null if parsing or extraction fails.
 */
export function extractFontConfigAst(callSource: string): GoogleFontConfig | null {
  const node = parseExpression(callSource);
  if (!node || node.type !== 'ObjectExpression') return null;

  const props = objectProperties(node as ObjectExpressionNode);
  const config: GoogleFontConfig = {};

  // subsets: string[]
  const subsetsNode = props.get('subsets');
  if (subsetsNode) {
    const arr = extractStringArray(subsetsNode);
    if (arr) config.subsets = arr;
  }

  // weight: string | string[]
  const weightNode = props.get('weight');
  if (weightNode) {
    const arr = extractStringArray(weightNode);
    if (arr) {
      config.weight = arr;
    } else {
      const s = extractString(weightNode);
      if (s !== undefined) config.weight = s;
    }
  }

  // display: string
  const displayNode = props.get('display');
  if (displayNode) {
    const s = extractString(displayNode);
    if (s !== undefined) config.display = s as GoogleFontConfig['display'];
  }

  // variable: string
  const variableNode = props.get('variable');
  if (variableNode) {
    const s = extractString(variableNode);
    if (s !== undefined) config.variable = s;
  }

  // style: string | string[]
  const styleNode = props.get('style');
  if (styleNode) {
    const arr = extractStringArray(styleNode);
    if (arr) {
      config.style = arr;
    } else {
      const s = extractString(styleNode);
      if (s !== undefined) config.style = s;
    }
  }

  // preload: boolean
  const preloadNode = props.get('preload');
  if (preloadNode) {
    const b = extractBoolean(preloadNode);
    if (b !== undefined) config.preload = b;
  }

  return config;
}

// ── Local font config extraction ─────────────────────────────────────────────

/**
 * Extract a single LocalFontSrc entry from an ObjectExpression AST node.
 */
function extractLocalFontSrcEntry(node: AstNode): LocalFontSrc | null {
  if (node.type !== 'ObjectExpression') return null;
  const props = objectProperties(node as ObjectExpressionNode);

  const pathNode = props.get('path');
  if (!pathNode) return null;
  const path = extractString(pathNode);
  if (path === undefined) return null;

  const entry: LocalFontSrc = { path };

  const weightNode = props.get('weight');
  if (weightNode) {
    const w = extractString(weightNode);
    if (w !== undefined) entry.weight = w;
  }

  const styleNode = props.get('style');
  if (styleNode) {
    const s = extractString(styleNode);
    if (s !== undefined) entry.style = s;
  }

  return entry;
}

/**
 * Extract a LocalFontConfig from the source text of a localFont() call's
 * object argument.
 *
 * Returns null if parsing or extraction fails.
 */
export function extractLocalFontConfigAst(callSource: string): LocalFontConfig | null {
  const node = parseExpression(callSource);
  if (!node || node.type !== 'ObjectExpression') return null;

  const props = objectProperties(node as ObjectExpressionNode);

  // display: string
  const displayNode = props.get('display');
  const display = displayNode
    ? (extractString(displayNode) as LocalFontConfig['display'])
    : undefined;

  // variable: string
  const variableNode = props.get('variable');
  const variable = variableNode ? extractString(variableNode) : undefined;

  // family: string
  const familyNode = props.get('family');
  const family = familyNode ? extractString(familyNode) : undefined;

  // src: string | LocalFontSrc[]
  const srcNode = props.get('src');
  if (!srcNode) return null;

  // String form: src: './fonts/MyFont.woff2'
  const srcString = extractString(srcNode);
  if (srcString !== undefined) {
    return { src: srcString, display, variable, family };
  }

  // Array form: src: [{ path: '...', weight: '...' }, ...]
  if (srcNode.type === 'ArrayExpression') {
    const arr = srcNode as ArrayExpressionNode;
    const entries: LocalFontSrc[] = [];
    for (const elem of arr.elements) {
      const entry = extractLocalFontSrcEntry(elem);
      if (!entry) return null;
      entries.push(entry);
    }
    if (entries.length === 0) return null;
    return { src: entries, display, variable, family };
  }

  return null;
}

// ── Dynamic call detection ───────────────────────────────────────────────────

/**
 * Detect if source code contains dynamic/computed font function calls
 * that cannot be statically analyzed.
 *
 * Uses acorn to parse the full source and inspect CallExpression nodes.
 * Returns the offending expression string if found, null if all calls are static.
 */
export function detectDynamicFontCallAst(
  source: string,
  importedNames: string[]
): string | null {
  if (importedNames.length === 0) return null;

  let ast;
  try {
    ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    }) as unknown as { body: AstNode[] };
  } catch {
    // If we can't parse the source at all, fall back to no detection
    return null;
  }

  const nameSet = new Set(importedNames);
  const result = walkForDynamicCalls(ast as unknown as AstNode, nameSet, source);
  return result;
}

/**
 * Recursively walk the AST looking for CallExpression nodes where
 * the callee is one of the imported font names and the first argument
 * is not an ObjectExpression (i.e. it's dynamic).
 */
function walkForDynamicCalls(
  node: AstNode,
  names: Set<string>,
  source: string
): string | null {
  if (!node || typeof node !== 'object') return null;

  if (node.type === 'CallExpression') {
    const callee = node.callee as AstNode;
    if (callee.type === 'Identifier' && names.has((callee as IdentifierNode).name)) {
      const args = node.arguments as AstNode[];
      if (args.length > 0 && args[0].type !== 'ObjectExpression') {
        // Extract the argument source text
        const argStart = (args[0] as AstNode & { start: number }).start;
        const argEnd = (args[0] as AstNode & { end: number }).end;
        const argText = source.slice(argStart, argEnd);
        const calleeName = (callee as IdentifierNode).name;
        return `${calleeName}(${argText})`;
      }
    }
  }

  // Walk all child properties
  for (const key of Object.keys(node)) {
    if (key === 'type') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && (item as AstNode).type) {
          const result = walkForDynamicCalls(item as AstNode, names, source);
          if (result) return result;
        }
      }
    } else if (child && typeof child === 'object' && (child as AstNode).type) {
      const result = walkForDynamicCalls(child as AstNode, names, source);
      if (result) return result;
    }
  }

  return null;
}
