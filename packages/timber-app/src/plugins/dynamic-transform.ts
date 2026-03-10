/**
 * timber-dynamic-transform — Vite sub-plugin for 'use dynamic' directive.
 *
 * Detects `'use dynamic'` directives in server component function bodies
 * and transforms them into `markDynamic()` runtime calls. The directive
 * declares a dynamic boundary — the component and its subtree opt out of
 * the pre-rendered shell and render per-request.
 *
 * - In `output: 'static'` mode, `'use dynamic'` is a build error.
 * - In standard SSR routes (no prerender.ts), the directive is a no-op
 *   (everything is already per-request), but the transform still runs
 *   so the runtime can skip unnecessary work.
 *
 * Design doc: design/15-future-prerendering.md §"'use dynamic'"
 */

import type { Plugin } from 'vite';
import type { PluginContext } from '../index.js';
import { findFunctionsWithDirective, containsDirective } from '../utils/directive-parser.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Quick check: does this source file contain 'use dynamic' anywhere?
 * Used as a fast bail-out before doing expensive AST parsing.
 */
export function containsUseDynamic(code: string): boolean {
  return containsDirective(code, 'use dynamic');
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

interface TransformResult {
  code: string;
  map?: null;
}

/**
 * Find function declarations/expressions containing 'use dynamic' and
 * transform them into markDynamic() calls.
 *
 * Input:
 * ```tsx
 * export default async function AddToCartButton({ productId }) {
 *   'use dynamic'
 *   const user = await getUser()
 *   return <button>Add to cart</button>
 * }
 * ```
 *
 * Output:
 * ```tsx
 * import { markDynamic as __markDynamic } from '@timber/app/runtime';
 * export default async function AddToCartButton({ productId }) {
 *   __markDynamic();
 *   const user = await getUser()
 *   return <button>Add to cart</button>
 * }
 * ```
 *
 * The markDynamic() call registers the component boundary as dynamic
 * at render time. The pre-render pass uses this to know which subtrees
 * to skip and leave as holes for per-request rendering.
 */
export function transformUseDynamic(code: string): TransformResult | null {
  if (!containsUseDynamic(code)) return null;

  const functions = findFunctionsWithDirective(code, 'use dynamic');
  if (functions.length === 0) return null;

  // Replace directive strings with __markDynamic() calls, processing
  // from end to start to preserve source offsets
  let result = code;
  for (const fn of functions) {
    // Replace the directive in the body content
    const cleanBody = fn.bodyContent.replace(/['"]use dynamic['"];?/, '__markDynamic();');
    // Reconstruct: replace the body content between braces
    result = result.slice(0, fn.bodyStart) + cleanBody + result.slice(fn.bodyEnd);
  }

  // Add the import at the top
  result = `import { markDynamic as __markDynamic } from '@timber/app/runtime';\n` + result;

  return { code: result, map: null };
}

// ---------------------------------------------------------------------------
// Static mode validation
// ---------------------------------------------------------------------------

/**
 * In `output: 'static'` mode, `'use dynamic'` is a build error.
 * Static mode renders everything at build time — there is no per-request
 * rendering to opt into.
 */
export function validateNoDynamicInStaticMode(
  code: string
): { message: string; line?: number } | null {
  if (!containsUseDynamic(code)) return null;

  const functions = findFunctionsWithDirective(code, 'use dynamic');
  if (functions.length === 0) return null;

  return {
    message:
      `'use dynamic' cannot be used in static mode (output: 'static'). ` +
      `Static mode renders all content at build time — there is no per-request rendering. ` +
      `Remove the directive or switch to output: 'server'.`,
    line: functions[functions.length - 1].directiveLine, // First occurrence (sorted descending)
  };
}

// ---------------------------------------------------------------------------
// Vite Plugin
// ---------------------------------------------------------------------------

/**
 * Create the timber-dynamic-transform Vite plugin.
 *
 * In server mode: transforms 'use dynamic' into markDynamic() calls.
 * In static mode: rejects 'use dynamic' as a build error.
 */
export function timberDynamicTransform(ctx: PluginContext): Plugin {
  const isStatic = ctx.config.output === 'static';

  return {
    name: 'timber-dynamic-transform',

    transform(code: string, id: string) {
      // Skip node_modules
      if (id.includes('node_modules')) return null;

      // Only check files in the app directory
      if (!id.includes('/app/') && !id.startsWith('app/')) return null;

      // Only check JS/TS files
      if (!/\.[jt]sx?$/.test(id)) return null;

      // Quick bail-out
      if (!containsUseDynamic(code)) return null;

      // In static mode, 'use dynamic' is a build error
      if (isStatic) {
        const error = validateNoDynamicInStaticMode(code);
        if (error) {
          this.error(
            `[timber] Static mode error in ${id}${error.line ? `:${error.line}` : ''}: ${error.message}`
          );
        }
        return null;
      }

      // In server mode, transform the directive
      return transformUseDynamic(code);
    },
  };
}
