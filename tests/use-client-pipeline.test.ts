import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..', 'packages/timber-app/src');

/**
 * Tests for the "use client" component pipeline.
 *
 * Validates that timber correctly wires client components through
 * RSC → SSR → client:
 *
 * 1. RSC: serializes client components as references (not rendered)
 * 2. SSR: resolves references and renders to HTML
 * 3. Client: hydrates interactive components
 *
 * Full integration tests require a running Vite dev server with the
 * RSC plugin. These unit tests verify the structural contracts:
 * correct imports, module map creation, and reference handling.
 */

// ─── RSC Entry: Client Reference Serialization ─────────────────────────

describe('RSC entry — client reference serialization', () => {
  it('imports renderToReadableStream from @vitejs/plugin-rsc/rsc', () => {
    const content = readFileSync(resolve(SRC_DIR, 'server/rsc-entry.ts'), 'utf-8');
    // RSC entry must use the RSC plugin's renderToReadableStream,
    // which serializes client components as references in the stream.
    expect(content).toContain("from '@vitejs/plugin-rsc/rsc'");
    expect(content).toContain('renderToReadableStream');
  });

  it('does not use react-dom/server renderToReadableStream for RSC', () => {
    const content = readFileSync(resolve(SRC_DIR, 'server/rsc-entry.ts'), 'utf-8');
    // react-dom/server renderToReadableStream does NOT handle client
    // references — it would try to render client components on the server.
    expect(content).not.toContain("from 'react-dom/server'");
  });

  it('uses onClientReference callback for reference tracking', () => {
    const content = readFileSync(resolve(SRC_DIR, 'server/rsc-entry.ts'), 'utf-8');
    // The RSC plugin creates the client manifest internally.
    // timber passes an onClientReference callback to track client deps.
    expect(content).toContain('onClientReference');
  });
});

// ─── SSR Entry: Client Reference Resolution ────────────────────────────

describe('SSR entry — client reference resolution', () => {
  it('imports createFromReadableStream from @vitejs/plugin-rsc/ssr', () => {
    const content = readFileSync(resolve(SRC_DIR, 'server/ssr-entry.ts'), 'utf-8');
    expect(content).toContain("from '@vitejs/plugin-rsc/ssr'");
    expect(content).toContain('createFromReadableStream');
  });

  it('uses renderToReadableStream from react-dom/server for SSR HTML', () => {
    // SSR needs react-dom/server to produce HTML — the RSC stream has
    // already been decoded into React elements at this point.
    const ssrRenderContent = readFileSync(resolve(SRC_DIR, 'server/ssr-render.ts'), 'utf-8');
    expect(ssrRenderContent).toContain("from 'react-dom/server'");
    expect(ssrRenderContent).toContain('renderToReadableStream');
  });
});

// ─── Browser Entry: Client Hydration ────────────────────────────────────

describe('browser entry — client hydration', () => {
  it('imports createFromReadableStream from @vitejs/plugin-rsc/browser', () => {
    const content = readFileSync(resolve(SRC_DIR, 'client/browser-entry.ts'), 'utf-8');
    expect(content).toContain("from '@vitejs/plugin-rsc/browser'");
    expect(content).toContain('createFromReadableStream');
  });

  it('calls hydrateRoot for React hydration', () => {
    const content = readFileSync(resolve(SRC_DIR, 'client/browser-entry.ts'), 'utf-8');
    expect(content).toContain('hydrateRoot');
  });
});

// ─── Module ID Consistency ──────────────────────────────────────────────

describe('module ID consistency across environments', () => {
  it('RSC and SSR entries both reference the RSC plugin for stream handling', () => {
    const rscContent = readFileSync(resolve(SRC_DIR, 'server/rsc-entry.ts'), 'utf-8');
    const ssrContent = readFileSync(resolve(SRC_DIR, 'server/ssr-entry.ts'), 'utf-8');

    // RSC produces the stream via @vitejs/plugin-rsc/rsc
    expect(rscContent).toContain('@vitejs/plugin-rsc/rsc');
    // SSR consumes the stream via @vitejs/plugin-rsc/ssr
    expect(ssrContent).toContain('@vitejs/plugin-rsc/ssr');
  });

  it('client module map exists for SSR reference resolution', () => {
    const { existsSync } = require('node:fs');
    expect(existsSync(resolve(SRC_DIR, 'server/client-module-map.ts'))).toBe(true);
  });
});

// ─── Server-Only Exclusion ──────────────────────────────────────────────

describe('server-only exclusion from client bundle', () => {
  it('browser entry does not import server modules', () => {
    const content = readFileSync(resolve(SRC_DIR, 'client/browser-entry.ts'), 'utf-8');
    // The browser entry must not import any server-side modules
    expect(content).not.toContain("from '../server/");
    expect(content).not.toContain("from './pipeline");
    expect(content).not.toContain("from 'react-dom/server'");
  });

  it('RSC entry does not import client runtime modules', () => {
    const content = readFileSync(resolve(SRC_DIR, 'server/rsc-entry.ts'), 'utf-8');
    // RSC entry should not import client runtime modules (router, segment cache).
    // Importing 'use client' components like SegmentProvider is fine — they become
    // serialized client references in the RSC Flight stream, not executed server-side.
    expect(content).not.toContain("from '../client/router");
    expect(content).not.toContain("from '../client/segment-cache");
    expect(content).not.toContain("from '../client/browser-entry");
    expect(content).not.toContain("from './router");
  });
});

// ─── Client Module Map ─────────────────────────────────────────────────

describe('client-module-map', () => {
  it('exports createClientModuleMap function', async () => {
    const mod = await import(resolve(SRC_DIR, 'server/client-module-map.ts'));
    expect(typeof mod.createClientModuleMap).toBe('function');
  });

  it('createClientModuleMap returns an object', async () => {
    const mod = await import(resolve(SRC_DIR, 'server/client-module-map.ts'));
    const map = mod.createClientModuleMap();
    expect(typeof map).toBe('object');
    expect(map).not.toBeNull();
  });
});

// ─── SSR Render ─────────────────────────────────────────────────────────

describe('SSR render — preserves existing behavior', () => {
  it('renderSsrStream renders basic elements', async () => {
    const { renderSsrStream } = await import(resolve(SRC_DIR, 'server/ssr-render.ts'));
    const { createElement } = await import('react');

    const element = createElement('div', { 'data-testid': 'use-client-test' }, 'Hello');
    const stream = await renderSsrStream(element);

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let html = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value);
    }

    expect(html).toContain('Hello');
    expect(html).toContain('<div');
  });
});
