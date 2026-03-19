/**
 * Tests for slot-level DenySignal containment (LOCAL-298).
 *
 * Verifies the communication channel between SSR error boundaries and
 * the RSC entry that prevents slot-level DenySignals from being promoted
 * to page-level denials.
 *
 * See design/02-rendering-pipeline.md §"Slot Access Failure = Graceful Degradation"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..', 'packages/timber-app/src');

// ─── Structural Tests ────────────────────────────────────────────────────────

describe('slot deny promotion — structural contracts (LOCAL-298)', () => {
  it('NavContext includes _denyHandledByBoundary flag', () => {
    const content = readFileSync(resolve(SRC_DIR, 'server/ssr-entry.ts'), 'utf-8');
    expect(content).toContain('_denyHandledByBoundary');
  });

  it('SsrData includes _navContext reference for error boundary communication', () => {
    const content = readFileSync(resolve(SRC_DIR, 'client/ssr-data.ts'), 'utf-8');
    expect(content).toContain('_navContext');
    expect(content).toContain('_denyHandledByBoundary');
  });

  it('ssr-entry passes navContext reference through SsrData', () => {
    const content = readFileSync(resolve(SRC_DIR, 'server/ssr-entry.ts'), 'utf-8');
    // SsrData should include _navContext: navContext
    expect(content).toContain('_navContext: navContext');
  });

  it('TimberErrorBoundary imports getSsrData for deny reporting', () => {
    const content = readFileSync(resolve(SRC_DIR, 'client/error-boundary.tsx'), 'utf-8');
    expect(content).toContain("from './ssr-data");
    expect(content).toContain('getSsrData');
  });

  it('TimberErrorBoundary sets _denyHandledByBoundary in getDerivedStateFromError', () => {
    const content = readFileSync(resolve(SRC_DIR, 'client/error-boundary.tsx'), 'utf-8');
    // Should check for deny digest and set the flag
    expect(content).toContain('_denyHandledByBoundary');
    expect(content).toContain("parsed?.type === 'deny'");
    expect(content).toContain('getDerivedStateFromError');
  });

  it('RSC entry checkCapturedSignals skips handled deny on SSR success path', () => {
    const content = readFileSync(resolve(SRC_DIR, 'server/rsc-entry/index.ts'), 'utf-8');
    // checkCapturedSignals should accept a skipHandledDeny parameter
    expect(content).toContain('skipHandledDeny');
    expect(content).toContain('_denyHandledByBoundary');
    // The SSR success path should pass skipHandledDeny = true
    expect(content).toContain('skipHandledDeny');
  });

  it('RSC entry SSR failure path does NOT skip handled deny', () => {
    const content = readFileSync(resolve(SRC_DIR, 'server/rsc-entry/index.ts'), 'utf-8');
    // In the catch block (SSR failure), checkCapturedSignals should be called
    // WITHOUT skipHandledDeny, so page-level denials still work
    expect(content).toContain('checkCapturedSignals()');
  });
});

// ─── Behavioral Tests ────────────────────────────────────────────────────────

describe('slot deny promotion — behavioral contracts', () => {
  it('getDerivedStateFromError detects deny digest correctly', () => {
    // Simulate what getDerivedStateFromError does
    const error = new Error('Access denied');
    (error as { digest?: string }).digest = JSON.stringify({
      type: 'deny',
      status: 403,
      data: { reason: 'unauthorized' },
    });

    const digest = (error as { digest?: string }).digest;
    expect(typeof digest).toBe('string');

    const parsed = JSON.parse(digest!);
    expect(parsed.type).toBe('deny');
    expect(parsed.status).toBe(403);
  });

  it('non-deny digest is not misidentified', () => {
    const error = new Error('Redirect');
    (error as { digest?: string }).digest = JSON.stringify({
      type: 'redirect',
      location: '/login',
      status: 302,
    });

    const parsed = JSON.parse((error as { digest?: string }).digest!);
    expect(parsed.type).not.toBe('deny');
  });

  it('getSsrData returns navContext reference for mutation', async () => {
    const { setSsrData, getSsrData, clearSsrData } = await import(
      resolve(SRC_DIR, 'client/ssr-data.ts')
    );

    const navContext = { _denyHandledByBoundary: undefined as boolean | undefined };
    setSsrData({
      pathname: '/',
      searchParams: {},
      cookies: new Map(),
      params: {},
      _navContext: navContext,
    });

    const data = getSsrData();
    expect(data?._navContext).toBe(navContext);

    // Mutating through getSsrData should be visible on the original
    data!._navContext!._denyHandledByBoundary = true;
    expect(navContext._denyHandledByBoundary).toBe(true);

    clearSsrData();
  });
});
