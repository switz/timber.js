/**
 * timber-static-build — Vite sub-plugin for static output mode.
 *
 * When `output: 'static'` is set in timber.config.ts, this plugin:
 * 1. Validates that no dynamic APIs (cookies(), headers()) are used
 * 2. When client JavaScript is disabled, rejects 'use client' and 'use server' directives
 * 3. Coordinates build-time rendering of all pages
 *
 * Design doc: design/15-future-prerendering.md
 */

import type { Plugin } from 'vite';
import type { PluginContext } from '#/index.js';
import { detectFileDirective } from '#/utils/directive-parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaticValidationError {
  type: 'dynamic-api' | 'nojs-directive';
  file: string;
  message: string;
  line?: number;
}

export interface StaticOptions {
  clientJavascriptDisabled: boolean;
}

// ---------------------------------------------------------------------------
// Detection: dynamic APIs (cookies, headers)
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate dynamic per-request API usage.
 * These are build errors in static mode because there is no request at build time.
 *
 * We detect both import-level and call-level usage.
 */
const DYNAMIC_API_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bcookies\s*\(/, name: 'cookies()' },
  { pattern: /\bheaders\s*\(/, name: 'headers()' },
];

/**
 * Detect usage of dynamic per-request APIs (cookies(), headers())
 * that cannot work at build time in static mode.
 *
 * Returns an array of validation errors.
 */
export function detectDynamicApis(code: string, fileId: string): StaticValidationError[] {
  const errors: StaticValidationError[] = [];

  for (const { pattern, name } of DYNAMIC_API_PATTERNS) {
    if (pattern.test(code)) {
      // Find the line number of the first match
      const lines = code.split('\n');
      let line: number | undefined;
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          line = i + 1;
          break;
        }
      }

      errors.push({
        type: 'dynamic-api',
        file: fileId,
        message:
          `${name} cannot be used in static mode — there is no request at build time. ` +
          `Remove the ${name} call or switch to output: 'server'.`,
        line,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Detection: 'use client' / 'use server' directives (clientJavascript disabled)
// ---------------------------------------------------------------------------

/**
 * Detect 'use client' and 'use server' directives using AST-based parsing.
 * When client JavaScript is disabled, both are hard build errors — no React
 * runtime or server actions are allowed in the output.
 *
 * When client JavaScript is enabled, these are allowed (client components
 * hydrate, server actions get extracted to API endpoints).
 */
export function detectDirectives(
  code: string,
  fileId: string,
  options: StaticOptions
): StaticValidationError[] {
  if (!options.clientJavascriptDisabled) return [];

  const errors: StaticValidationError[] = [];

  const clientDirective = detectFileDirective(code, ['use client']);
  if (clientDirective) {
    errors.push({
      type: 'nojs-directive',
      file: fileId,
      message:
        `'use client' is not allowed when client JavaScript is disabled (clientJavascript: false). ` +
        `This mode produces zero JavaScript — client components cannot exist.`,
      line: clientDirective.line,
    });
  }

  const serverDirective = detectFileDirective(code, ['use server']);
  if (serverDirective) {
    errors.push({
      type: 'nojs-directive',
      file: fileId,
      message:
        `'use server' is not allowed when client JavaScript is disabled (clientJavascript: false). ` +
        `This mode produces zero JavaScript — server actions cannot exist.`,
      line: serverDirective.line,
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Combined validation
// ---------------------------------------------------------------------------

/**
 * Run all static mode validations on a source file.
 *
 * Combines:
 * - Dynamic API detection (cookies, headers) — always in static mode
 * - Directive detection ('use client', 'use server') — only when client JS is disabled
 */
export function validateStaticMode(
  code: string,
  fileId: string,
  options: StaticOptions
): StaticValidationError[] {
  const errors: StaticValidationError[] = [];

  errors.push(...detectDynamicApis(code, fileId));
  errors.push(...detectDirectives(code, fileId, options));

  return errors;
}

// ---------------------------------------------------------------------------
// Vite Plugin
// ---------------------------------------------------------------------------

/**
 * Create the timber-static-build Vite plugin.
 *
 * Only active when output: 'static' is configured.
 *
 * Hooks:
 * - transform: Validates source files for static mode violations
 */
export function timberStaticBuild(ctx: PluginContext): Plugin {
  const isStatic = ctx.config.output === 'static';
  const clientJavascriptDisabled = ctx.clientJavascript.disabled;

  return {
    name: 'timber-static-build',

    /**
     * Validate source files during transform.
     *
     * In static mode, we check every app/ file for:
     * - Dynamic API usage (cookies(), headers()) → build error
     * - When client JS disabled: 'use client' / 'use server' directives → build error
     */
    transform(code: string, id: string) {
      // Only active in static mode
      if (!isStatic) return null;

      // Skip node_modules
      if (id.includes('node_modules')) return null;

      // Only check files in the app directory
      if (!id.includes('/app/') && !id.startsWith('app/')) return null;

      // Only check JS/TS files
      if (!/\.[jt]sx?$/.test(id)) return null;

      const errors = validateStaticMode(code, id, { clientJavascriptDisabled });

      if (errors.length > 0) {
        // Format all errors into a single build error message
        const messages = errors.map(
          (e) =>
            `[timber] Static mode error in ${e.file}${e.line ? `:${e.line}` : ''}: ${e.message}`
        );

        this.error(messages.join('\n\n'));
      }

      return null;
    },
  };
}
