/**
 * Twoslash transformer configuration for the docs site.
 *
 * Auto-enables twoslash on code blocks that import from `@timber/app/*`.
 * Uses CSS Anchor Positioning for tooltip placement.
 */

import { transformerTwoslash } from '@shikijs/twoslash';
import type { TwoslashTypesCache, TwoslashShikiReturn } from '@shikijs/twoslash';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ShikiTransformer } from 'shiki';
import { rendererCssAnchor } from './twoslash-renderer.js';

const TIMBER_IMPORT_RE = /@timber\/app/;

const CACHE_DIR = resolve(import.meta.dirname, '../.twoslash-cache');

/**
 * Virtual files providing real type stubs for common non-timber imports
 * used in doc code samples (`@/lib/auth`, `zod/v4`, `content-collections`, etc.).
 *
 * These are injected into the twoslash virtual filesystem via `extraFiles`
 * so path aliases like `@/*` resolve them. Timber types resolve naturally
 * via compilerOptions.paths — these stubs cover everything else.
 */
const EXTRA_FILES: Record<string, string> = {
  'lib/auth.ts': [
    'interface User { id: string; name: string; email: string; role: "admin" | "user"; }',
    'export declare function getUser(): Promise<User | null>;',
    'export declare function requireUser(): Promise<User>;',
  ].join('\n'),

  'lib/db.ts': [
    'interface QueryResult<T = Record<string, unknown>> { rows: T[]; rowCount: number; }',
    'export declare function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;',
    'export declare function db<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<QueryResult<T>>;',
  ].join('\n'),

  'lib/action.ts': [
    'import { createActionClient } from "@timber/app/server";',
    'export declare const action: ReturnType<typeof createActionClient>;',
  ].join('\n'),
};

/**
 * File-system cache for twoslash type resolution results.
 * Keyed by SHA-256 of (code + lang) — only re-analyzes on content change.
 */
function createFsCache(): TwoslashTypesCache {
  return {
    init() {
      if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
      }
    },

    read(code, lang) {
      const key = cacheKey(code, lang);
      const path = resolve(CACHE_DIR, `${key}.json`);
      try {
        if (existsSync(path)) {
          return JSON.parse(readFileSync(path, 'utf-8')) as TwoslashShikiReturn;
        }
      } catch {
        // Corrupted cache entry — will be rewritten
      }
      return null;
    },

    write(code, data, lang) {
      const key = cacheKey(code, lang);
      const path = resolve(CACHE_DIR, `${key}.json`);
      try {
        writeFileSync(path, JSON.stringify(data));
      } catch {
        // Non-fatal — next build will just re-analyze
      }
    },
  };
}

function cacheKey(code: string, lang?: string): string {
  return createHash('sha256')
    .update(`${lang ?? 'ts'}:${code}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Creates the twoslash shiki transformer configured for the docs site.
 *
 * - Auto-detects `@timber/app` imports in ts/tsx blocks
 * - Also processes blocks with explicit `twoslash` meta tag
 * - Provides real type stubs for common non-timber imports
 * - Caches type resolution to disk
 */
export function createTwoslashTransformer(): ShikiTransformer {
  return transformerTwoslash({
    renderer: rendererCssAnchor(),
    typesCache: createFsCache(),

    // Custom filter: auto-enable for @timber/app imports, or explicit twoslash meta
    filter(lang, code, options) {
      // Check for explicit twoslash meta
      const meta = (options.meta as Record<string, unknown>)?.__raw;
      if (typeof meta === 'string' && /\btwoslash\b/.test(meta)) {
        return true;
      }

      // Auto-detect @timber/app imports in TypeScript blocks
      if (['ts', 'tsx', 'typescript', 'typescriptreact'].includes(lang)) {
        return TIMBER_IMPORT_RE.test(code);
      }

      return false;
    },

    // Don't crash the build on type errors in code examples
    throws: false,
    onTwoslashError(error, code, lang) {
      console.warn(
        `[twoslash] Error in ${lang} code block: ${error instanceof Error ? error.message : error}`
      );
      console.warn(`  Code: ${code.slice(0, 80)}...`);
    },

    twoslashOptions: {
      // Suppress errors from partial code samples (missing relative imports, etc.)
      // Type info is still extracted for the symbols that do resolve.
      handbookOptions: { noErrors: true },
      // Virtual files for @/lib/* stubs — resolved via paths alias
      extraFiles: EXTRA_FILES,
      compilerOptions: {
        // Match the website's tsconfig paths so @timber/app imports resolve
        module: 99, // ESNext
        moduleResolution: 100, // Bundler
        target: 99, // ESNext
        jsx: 4, // react-jsx
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        noEmit: true,
        // Paths are resolved relative to the website package
        baseUrl: resolve(import.meta.dirname, '..'),
        paths: {
          '@timber/app': ['../timber-app/src/index.ts'],
          '@timber/app/*': ['../timber-app/src/*'],
          '@/*': ['./*'],
        },
      },
    },
  });
}
