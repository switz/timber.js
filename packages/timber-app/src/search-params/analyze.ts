/**
 * Static analyzability checker for search-params.ts files.
 *
 * Validates that a search-params.ts file's default export is statically
 * analyzable — a createSearchParams() call or a chain of .extend()/.pick()
 * calls on a SearchParamsDefinition.
 *
 * Non-analyzable files produce a hard build error with a diagnostic.
 *
 * Design doc: design/09-typescript.md §"Static Analyzability"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of analyzing a search-params.ts file. */
export interface AnalyzeResult {
  /** Whether the file is statically analyzable. */
  valid: boolean;
  /** Error details when valid is false. */
  error?: AnalyzeError;
}

/** Diagnostic error for non-analyzable search-params.ts. */
export interface AnalyzeError {
  /** Absolute file path. */
  filePath: string;
  /** Description of the non-analyzable expression. */
  expression: string;
  /** Suggested fix. */
  suggestion: string;
}

// ---------------------------------------------------------------------------
// AST-free source analysis
//
// We use a lightweight regex-based approach to validate the structure of the
// default export. This avoids requiring a TypeScript compiler instance at
// build time for the initial validation pass. The full type extraction
// (reading T from SearchParamsDefinition<T>) still happens via the TypeScript
// compiler in the codegen step — this module just validates the *shape*.
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate a valid default export:
 *
 * 1. `export default createSearchParams(...)`
 * 2. `export default someVar.extend(...)`
 * 3. `export default someVar.pick(...)`
 * 4. `export default someVar.extend(...).extend(...)`  (chained)
 * 5. `export default someVar.extend(...).pick(...)`    (chained)
 * 6. `export default createSearchParams(...).extend(...)`
 *
 * Invalid patterns:
 * - `export default someFunction(...)` (arbitrary factory)
 * - `export default condition ? a : b` (runtime conditional)
 * - `export default variable` (opaque reference without call)
 */

/**
 * Analyze a search-params.ts file source for static analyzability.
 *
 * @param source - The file content as a string
 * @param filePath - Absolute path to the file (for diagnostics)
 */
export function analyzeSearchParams(source: string, filePath: string): AnalyzeResult {
  // Strip comments to avoid false matches
  const stripped = stripComments(source);

  // Find the default export
  const defaultExport = extractDefaultExport(stripped);

  if (!defaultExport) {
    return {
      valid: false,
      error: {
        filePath,
        expression: '(no default export found)',
        suggestion:
          'search-params.ts must have a default export. Use: export default createSearchParams({ ... })',
      },
    };
  }

  // Validate the expression
  if (isValidExpression(defaultExport.trim())) {
    return { valid: true };
  }

  return {
    valid: false,
    error: {
      filePath,
      expression: defaultExport.trim(),
      suggestion:
        'The default export must be a createSearchParams() call, or a chain of ' +
        '.extend() / .pick() calls on a SearchParamsDefinition. Arbitrary factory ' +
        'functions and runtime conditionals are not supported.',
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip single-line and multi-line comments from source. */
function stripComments(source: string): string {
  // Remove multi-line comments
  let result = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments
  result = result.replace(/\/\/.*$/gm, '');
  return result;
}

/**
 * Extract the expression from `export default <expr>`.
 *
 * Handles both:
 *   export default createSearchParams(...)
 *   export default expr\n (terminated by newline or semicolon before next statement)
 */
function extractDefaultExport(source: string): string | undefined {
  // Match `export default` followed by the expression
  const match = source.match(/export\s+default\s+([\s\S]+?)(?:;|\n(?=export|import|const|let|var|function|class|type|interface|declare))/);
  if (match) {
    return match[1];
  }

  // Fallback: match everything after `export default` to end of file
  const fallback = source.match(/export\s+default\s+([\s\S]+)$/);
  if (fallback) {
    return fallback[1].replace(/;\s*$/, '');
  }

  return undefined;
}

/**
 * Check if an expression is a valid statically-analyzable pattern.
 *
 * Valid patterns:
 * - Starts with `createSearchParams(`
 * - Contains `.extend(` or `.pick(` chains (possibly starting with createSearchParams or a variable)
 * - A variable identifier followed by chaining
 */
function isValidExpression(expr: string): boolean {
  // Normalize whitespace
  const normalized = expr.replace(/\s+/g, ' ').trim();

  // Pattern 1: starts with createSearchParams(
  if (normalized.startsWith('createSearchParams(')) {
    return true;
  }

  // Pattern 2: chain ending with .extend(...) or .pick(...)
  // This covers: someVar.extend(...), createSearchParams(...).extend(...).pick(...), etc.
  if (/\.(extend|pick)\s*\(/.test(normalized)) {
    // Reject ternaries and other conditional patterns
    if (/\?/.test(normalized) && /:/.test(normalized)) {
      return false;
    }
    // Reject function declarations/expressions
    if (/^\s*(function|=>|\()/.test(normalized)) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Format an AnalyzeError into a human-readable build error message.
 */
export function formatAnalyzeError(error: AnalyzeError): string {
  return [
    `[timber] Non-analyzable search-params.ts`,
    ``,
    `  File: ${error.filePath}`,
    `  Expression: ${error.expression}`,
    ``,
    `  ${error.suggestion}`,
    ``,
    `  The framework must be able to statically extract the type from your`,
    `  search-params.ts at build time. Dynamic values, conditionals, and`,
    `  arbitrary factory functions prevent this analysis.`,
  ].join('\n');
}
