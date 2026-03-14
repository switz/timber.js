/**
 * Lint status files and error.tsx for missing 'use client' directive.
 *
 * Status files (error.tsx, 404.tsx, 4xx.tsx, 5xx.tsx, NNN.tsx) and legacy
 * compat files (not-found.tsx, forbidden.tsx, unauthorized.tsx) are passed
 * as fallbackComponent to TimberErrorBoundary — a 'use client' component.
 * RSC forbids passing server component functions as props to client
 * components, causing a hard-to-debug runtime error.
 *
 * This module provides a build/dev-time check that warns when these files
 * are missing the 'use client' directive.
 *
 * See design/10-error-handling.md §"Status-Code Files".
 */

import { readFileSync } from 'node:fs';
import type { RouteTree, SegmentNode } from './types.js';
import { detectFileDirective } from '#/utils/directive-parser.js';

/** Extensions that require 'use client' (component files, not MDX/JSON). */
const CLIENT_REQUIRED_EXTENSIONS = new Set(['tsx', 'jsx', 'ts', 'js']);

export interface StatusFileLintWarning {
  filePath: string;
  fileType: string;
}

/**
 * Walk the route tree and check all status files and error files for
 * the 'use client' directive. Returns an array of warnings for files
 * that are missing it.
 *
 * MDX and JSON status files are excluded — MDX files are server components
 * by design, and JSON files are data, not components.
 */
export function lintStatusFileDirectives(tree: RouteTree): StatusFileLintWarning[] {
  const warnings: StatusFileLintWarning[] = [];
  walkNode(tree.root, warnings);
  return warnings;
}

function walkNode(node: SegmentNode, warnings: StatusFileLintWarning[]): void {
  // Check error.tsx
  if (node.error) {
    checkFile(node.error.filePath, node.error.extension, 'error', warnings);
  }

  // Check status-code files (404.tsx, 4xx.tsx, 5xx.tsx, etc.)
  if (node.statusFiles) {
    for (const [code, file] of node.statusFiles) {
      checkFile(file.filePath, file.extension, code, warnings);
    }
  }

  // Check legacy compat files (not-found.tsx, forbidden.tsx, unauthorized.tsx)
  if (node.legacyStatusFiles) {
    for (const [name, file] of node.legacyStatusFiles) {
      checkFile(file.filePath, file.extension, name, warnings);
    }
  }

  // Recurse into children and slots
  for (const child of node.children) {
    walkNode(child, warnings);
  }
  for (const [, slotNode] of node.slots) {
    walkNode(slotNode, warnings);
  }
}

function checkFile(
  filePath: string,
  extension: string,
  fileType: string,
  warnings: StatusFileLintWarning[]
): void {
  if (!CLIENT_REQUIRED_EXTENSIONS.has(extension)) return;

  let code: string;
  try {
    code = readFileSync(filePath, 'utf-8');
  } catch {
    return; // File unreadable — skip silently
  }

  const directive = detectFileDirective(code, ['use client']);
  if (!directive) {
    warnings.push({ filePath, fileType });
  }
}

/**
 * Format warnings into human-readable console output.
 */
export function formatStatusFileLintWarnings(warnings: StatusFileLintWarning[]): string {
  const lines = [
    `[timber] ${warnings.length} status/error file${warnings.length > 1 ? 's' : ''} missing 'use client' directive:`,
    '',
  ];

  for (const w of warnings) {
    lines.push(`  ${w.filePath}`);
  }

  lines.push('');
  lines.push(
    "  Status files and error.tsx are rendered inside TimberErrorBoundary (a 'use client' component)."
  );
  lines.push(
    "  Add 'use client' as the first line of each file to avoid a runtime error."
  );

  return lines.join('\n');
}
