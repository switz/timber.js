/**
 * Tests for useParams() during actual SSR rendering.
 *
 * The existing ssr-hooks.test.ts only tests getSsrData()?.params directly.
 * This file verifies that useParams() returns correct route params when
 * called from a React component rendered via renderToReadableStream inside
 * an ALS scope — the actual SSR path.
 *
 * Reproduces LOCAL-305: useParams() returns {} during SSR.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  registerSsrDataProvider,
  setSsrData,
  clearSsrData,
  type SsrData,
} from '../packages/timber-app/src/client/ssr-data';
import { useParams, setCurrentParams } from '../packages/timber-app/src/client/use-params';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Collect a ReadableStream into a string. */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

/** Extract text content from an HTML element by data-testid. */
function extractTestIdContent(html: string, testId: string): string {
  // React HTML-encodes text content (e.g., " → &quot;), so we decode entities.
  const regex = new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`);
  const match = html.match(regex);
  if (!match) return '';
  return match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Helper to create SsrData with defaults. */
function makeSsrData(overrides: Partial<SsrData> = {}): SsrData {
  return {
    pathname: '/',
    searchParams: {},
    cookies: new Map(),
    params: {},
    ...overrides,
  };
}

/** Component that displays useParams() result as JSON. */
function ParamsDisplay() {
  const params = useParams();
  return React.createElement('div', { 'data-testid': 'params' }, JSON.stringify(params));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useParams() during SSR rendering', () => {
  const als = new AsyncLocalStorage<SsrData>();

  afterEach(() => {
    // Reset provider
    registerSsrDataProvider(undefined as never);
    clearSsrData();
    setCurrentParams({});
  });

  it('returns route params from ALS during SSR render', async () => {
    // Wire up ALS provider like ssr-entry.ts does
    registerSsrDataProvider(() => als.getStore());

    const ssrData = makeSsrData({ params: { id: '42', slug: 'hello-world' } });

    const html = await als.run(ssrData, async () => {
      // Also set module-level fallback like ssr-entry.ts does
      setCurrentParams(ssrData.params);

      const stream = await renderToReadableStream(
        React.createElement(ParamsDisplay)
      );
      return streamToString(stream);
    });

    const content = extractTestIdContent(html, 'params');
    expect(JSON.parse(content)).toEqual({ id: '42', slug: 'hello-world' });
  });

  it('returns route params from module-level fallback during SSR render', async () => {
    // No ALS provider — use module-level setSsrData fallback
    setSsrData(makeSsrData({ params: { category: 'electronics' } }));
    setCurrentParams({ category: 'electronics' });

    const stream = await renderToReadableStream(
      React.createElement(ParamsDisplay)
    );
    const html = await streamToString(stream);

    const content = extractTestIdContent(html, 'params');
    expect(JSON.parse(content)).toEqual({ category: 'electronics' });
  });

  it('returns empty params when no SSR data is available', async () => {
    // No ALS provider, no module-level state — should return {}
    const stream = await renderToReadableStream(
      React.createElement(ParamsDisplay)
    );
    const html = await streamToString(stream);

    const content = extractTestIdContent(html, 'params');
    expect(JSON.parse(content)).toEqual({});
  });

  it('globalThis provider survives module-level reset (cross-instance scenario)', async () => {
    // This simulates the module instance split in Vite SSR:
    // - ssr-entry.ts (src/) registers the ALS provider
    // - Client components (dist/) call getSsrData() from a different module instance
    //
    // The globalThis-based provider survives because it's not tied to
    // a module-level variable. We verify this by registering a provider,
    // then confirming getSsrData() still works even though module-level
    // state has been cleared.
    registerSsrDataProvider(() => als.getStore());

    const ssrData = makeSsrData({ params: { id: 'cross-instance' } });

    // Clear module-level state (simulates a fresh dist/ module instance
    // that has never had setSsrData called)
    clearSsrData();

    const html = await als.run(ssrData, async () => {
      const stream = await renderToReadableStream(
        React.createElement(ParamsDisplay)
      );
      return streamToString(stream);
    });

    const content = extractTestIdContent(html, 'params');
    expect(JSON.parse(content)).toEqual({ id: 'cross-instance' });
  });

  it('returns catch-all params (string[]) during SSR render', async () => {
    registerSsrDataProvider(() => als.getStore());

    const ssrData = makeSsrData({
      params: { path: ['docs', 'getting-started', 'install'] },
    });

    const html = await als.run(ssrData, async () => {
      setCurrentParams(ssrData.params);
      const stream = await renderToReadableStream(
        React.createElement(ParamsDisplay)
      );
      return streamToString(stream);
    });

    const content = extractTestIdContent(html, 'params');
    expect(JSON.parse(content)).toEqual({ path: ['docs', 'getting-started', 'install'] });
  });
});
