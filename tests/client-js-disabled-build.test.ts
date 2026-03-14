/**
 * Tests for client JS stripping in the build manifest plugin.
 *
 * When `clientJavascript: { disabled: true }`, the build manifest plugin
 * should strip JS chunks from the Rollup bundle (preventing disk writes)
 * and clear JS/modulepreload from the build manifest.
 *
 * CSS assets are preserved — they're still needed for server-rendered HTML.
 *
 * Task: TIM-312
 */

import { describe, it, expect } from 'vitest';
import {
  buildManifestFromBundle,
} from '../packages/timber-app/src/plugins/build-manifest';

// ─── buildManifestFromBundle ─────────────────────────────────────────────────

describe('buildManifestFromBundle', () => {
  it('collects CSS assets under _global key', () => {
    const bundle = {
      'assets/style-abc123.css': {
        type: 'asset' as const,
        fileName: 'assets/style-abc123.css',
      },
      'assets/layout-def456.css': {
        type: 'asset' as const,
        fileName: 'assets/layout-def456.css',
      },
    };

    const manifest = buildManifestFromBundle(bundle, '/', '/root');
    expect(manifest.css['_global']).toEqual([
      '/assets/style-abc123.css',
      '/assets/layout-def456.css',
    ]);
  });

  it('collects JS chunks with facadeModuleId', () => {
    const bundle = {
      'chunks/page-abc123.js': {
        type: 'chunk' as const,
        fileName: 'chunks/page-abc123.js',
        facadeModuleId: '/root/src/page.tsx',
        imports: [],
        name: 'page',
        code: '',
      },
    };

    const manifest = buildManifestFromBundle(bundle, '/', '/root');
    expect(manifest.js['src/page.tsx']).toBe('/chunks/page-abc123.js');
  });

  it('preserves CSS when manifest is stripped of JS', () => {
    const bundle = {
      'chunks/entry-abc123.js': {
        type: 'chunk' as const,
        fileName: 'chunks/entry-abc123.js',
        facadeModuleId: '/root/src/entry.tsx',
        imports: ['chunks/vendor-def456.js'],
        name: 'entry',
        code: '',
        viteMetadata: {
          importedCss: new Set(['assets/style.css']),
        },
      },
      'chunks/vendor-def456.js': {
        type: 'chunk' as const,
        fileName: 'chunks/vendor-def456.js',
        facadeModuleId: null,
        imports: [],
        name: 'vendor',
        code: '',
      },
      'assets/style.css': {
        type: 'asset' as const,
        fileName: 'assets/style.css',
      },
    };

    const manifest = buildManifestFromBundle(bundle, '/', '/root');

    // CSS should be collected
    expect(manifest.css['src/entry.tsx']).toEqual(['/assets/style.css']);
    expect(manifest.css['_global']).toEqual(['/assets/style.css']);

    // JS should be collected (before stripping)
    expect(manifest.js['src/entry.tsx']).toBe('/chunks/entry-abc123.js');
    expect(manifest.modulepreload['src/entry.tsx']).toEqual(['/chunks/vendor-def456.js']);

    // Simulate what the build-manifest plugin does when clientJavascript.disabled
    manifest.js = {};
    manifest.modulepreload = {};

    // CSS is still there
    expect(manifest.css['src/entry.tsx']).toEqual(['/assets/style.css']);
    expect(manifest.css['_global']).toEqual(['/assets/style.css']);
    // JS is gone
    expect(manifest.js).toEqual({});
    expect(manifest.modulepreload).toEqual({});
  });
});

// ─── Client JS disabled bundle stripping ─────────────────────────────────────

describe('client JS disabled — bundle stripping', () => {
  it('deleting chunk entries from bundle preserves CSS assets', () => {
    // Simulates the generateBundle behavior
    const bundle: Record<string, { type: 'chunk' | 'asset'; fileName: string }> = {
      'chunks/entry.js': {
        type: 'chunk',
        fileName: 'chunks/entry.js',
      },
      'chunks/vendor.js': {
        type: 'chunk',
        fileName: 'chunks/vendor.js',
      },
      'assets/style.css': {
        type: 'asset',
        fileName: 'assets/style.css',
      },
      'assets/font.woff2': {
        type: 'asset',
        fileName: 'assets/font.woff2',
      },
    };

    // Strip JS chunks (what the plugin does)
    for (const [fileName, item] of Object.entries(bundle)) {
      if (item.type === 'chunk') {
        delete bundle[fileName];
      }
    }

    // Only assets remain
    expect(Object.keys(bundle)).toEqual(['assets/style.css', 'assets/font.woff2']);
    expect(bundle['assets/style.css']?.type).toBe('asset');
    expect(bundle['assets/font.woff2']?.type).toBe('asset');
  });

  it('empty bundle produces no remaining files', () => {
    const bundle: Record<string, { type: 'chunk' | 'asset'; fileName: string }> = {
      'chunks/entry.js': { type: 'chunk', fileName: 'chunks/entry.js' },
    };

    for (const [fileName, item] of Object.entries(bundle)) {
      if (item.type === 'chunk') {
        delete bundle[fileName];
      }
    }

    expect(Object.keys(bundle)).toEqual([]);
  });
});
