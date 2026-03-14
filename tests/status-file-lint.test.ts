import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanRoutes } from '../packages/timber-app/src/routing/scanner';
import {
  lintStatusFileDirectives,
  formatStatusFileLintWarnings,
} from '../packages/timber-app/src/routing/status-file-lint';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTempApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'timber-lint-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

function scanAndLint(files: Record<string, string>) {
  const appDir = createTempApp(files);
  const tree = scanRoutes(appDir);
  return lintStatusFileDirectives(tree);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('status file lint: use client directive', () => {
  it('reports no warnings when error.tsx has use client', () => {
    const warnings = scanAndLint({
      'error.tsx': `'use client';\nexport default function E() { return <div>Error</div>; }`,
    });
    expect(warnings).toHaveLength(0);
  });

  it('warns when error.tsx is missing use client', () => {
    const warnings = scanAndLint({
      'error.tsx': `export default function E() { return <div>Error</div>; }`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fileType).toBe('error');
    expect(warnings[0].filePath).toContain('error.tsx');
  });

  it('warns when 404.tsx is missing use client', () => {
    const warnings = scanAndLint({
      '404.tsx': `export default function NotFound() { return <div>404</div>; }`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fileType).toBe('404');
  });

  it('reports no warnings when 404.tsx has use client', () => {
    const warnings = scanAndLint({
      '404.tsx': `'use client';\nexport default function NotFound() { return <div>404</div>; }`,
    });
    expect(warnings).toHaveLength(0);
  });

  it('warns when 5xx.tsx is missing use client', () => {
    const warnings = scanAndLint({
      '5xx.tsx': `export default function ServerError() { return <div>5xx</div>; }`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fileType).toBe('5xx');
  });

  it('warns when 4xx.tsx is missing use client', () => {
    const warnings = scanAndLint({
      '4xx.tsx': `export default function ClientError() { return <div>4xx</div>; }`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fileType).toBe('4xx');
  });

  it('warns when specific status code file (503.tsx) is missing use client', () => {
    const warnings = scanAndLint({
      '503.tsx': `export default function Unavailable() { return <div>503</div>; }`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fileType).toBe('503');
  });

  it('warns for legacy not-found.tsx missing use client', () => {
    const warnings = scanAndLint({
      'not-found.tsx': `export default function NF() { return <div>Not found</div>; }`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fileType).toBe('not-found');
  });

  it('warns for legacy forbidden.tsx missing use client', () => {
    const warnings = scanAndLint({
      'forbidden.tsx': `export default function F() { return <div>Forbidden</div>; }`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fileType).toBe('forbidden');
  });

  it('warns for legacy unauthorized.tsx missing use client', () => {
    const warnings = scanAndLint({
      'unauthorized.tsx': `export default function U() { return <div>Unauthorized</div>; }`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fileType).toBe('unauthorized');
  });

  it('does not warn for MDX status files', () => {
    const warnings = scanAndLint({
      '404.mdx': `# Not Found\n\nThis page does not exist.`,
    });
    expect(warnings).toHaveLength(0);
  });

  it('does not warn for JSON status files', () => {
    const warnings = scanAndLint({
      '401.json': `{"error": true, "status": 401}`,
    });
    expect(warnings).toHaveLength(0);
  });

  it('handles double-quoted use client directive', () => {
    const warnings = scanAndLint({
      'error.tsx': `"use client";\nexport default function E() { return <div>Error</div>; }`,
    });
    expect(warnings).toHaveLength(0);
  });

  it('handles use client without semicolon', () => {
    const warnings = scanAndLint({
      'error.tsx': `'use client'\nexport default function E() { return <div>Error</div>; }`,
    });
    expect(warnings).toHaveLength(0);
  });

  it('warns for multiple files across segments', () => {
    const warnings = scanAndLint({
      'error.tsx': `export default function E() { return <div>Error</div>; }`,
      '404.tsx': `export default function NF() { return <div>404</div>; }`,
      'dashboard/error.tsx': `export default function DE() { return <div>Dashboard Error</div>; }`,
      'dashboard/403.tsx': `'use client';\nexport default function F() { return <div>403</div>; }`,
    });
    expect(warnings).toHaveLength(3);
    const filePaths = warnings.map((w) => w.filePath);
    expect(filePaths.some((p) => p.endsWith('error.tsx') && !p.includes('dashboard'))).toBe(true);
    expect(filePaths.some((p) => p.endsWith('404.tsx'))).toBe(true);
    expect(filePaths.some((p) => p.includes('dashboard') && p.endsWith('error.tsx'))).toBe(true);
    // dashboard/403.tsx has 'use client' — should not be in warnings
    expect(filePaths.some((p) => p.endsWith('403.tsx'))).toBe(false);
  });

  it('checks status files in parallel slots', () => {
    const warnings = scanAndLint({
      'page.tsx': `export default function P() { return <div>Page</div>; }`,
      '@admin/page.tsx': `export default function AP() { return <div>Admin</div>; }`,
      '@admin/error.tsx': `export default function AE() { return <div>Admin Error</div>; }`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].filePath).toContain('@admin');
    expect(warnings[0].fileType).toBe('error');
  });
});

describe('formatStatusFileLintWarnings', () => {
  it('formats a single warning', () => {
    const output = formatStatusFileLintWarnings([
      { filePath: '/app/error.tsx', fileType: 'error' },
    ]);
    expect(output).toContain('[timber]');
    expect(output).toContain("missing 'use client'");
    expect(output).toContain('/app/error.tsx');
    expect(output).toContain("Add 'use client'");
  });

  it('formats multiple warnings', () => {
    const output = formatStatusFileLintWarnings([
      { filePath: '/app/error.tsx', fileType: 'error' },
      { filePath: '/app/404.tsx', fileType: '404' },
    ]);
    expect(output).toContain('2 status/error files');
    expect(output).toContain('/app/error.tsx');
    expect(output).toContain('/app/404.tsx');
  });
});
