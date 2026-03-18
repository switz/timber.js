/**
 * Static export validation tests.
 *
 * Tests that static mode (output: 'static') and clientJavascript disabled mode correctly
 * validate source files and produce the right client bootstrap configuration.
 *
 * These tests validate:
 * - The Vite plugin transform hook filters and validates correctly
 * - buildClientScripts produces empty config in clientJavascript disabled mode
 * - Static + clientJavascript disabled adapter builds handle missing client dirs
 * - Combined validation catches all error classes
 *
 * Design docs: design/11-platform.md, design/25-production-deployments.md
 * Task: timber-5oh
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateStaticMode,
  detectDynamicApis,
  detectDirectives,
} from '../packages/timber-app/src/plugins/static-build';
import { buildClientScripts } from '../packages/timber-app/src/server/html-injectors';
import { cloudflare } from '../packages/timber-app/src/adapters/cloudflare';
import { nitro } from '../packages/timber-app/src/adapters/nitro';
import type { TimberConfig } from '../packages/timber-app/src/adapters/types';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'timber-static-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Static HTML output ───────────────────────────────────────────────────

describe('static HTML output', () => {
  it('clean server component passes static validation', () => {
    const code = `
export default async function HomePage() {
  const posts = await fetch('https://api.example.com/posts').then(r => r.json())
  return (
    <main>
      <h1>Blog</h1>
      {posts.map(p => <article key={p.id}><h2>{p.title}</h2></article>)}
    </main>
  )
}
`;
    const errors = validateStaticMode(code, 'app/page.tsx', { clientJavascriptDisabled: false });
    expect(errors).toHaveLength(0);
  });

  it('static pages with data fetching pass validation', () => {
    const code = `
import { db } from '@/lib/db'

export default async function DocsPage({ params }) {
  const doc = await db.docs.findOne({ slug: params.slug })
  return <article>{doc.content}</article>
}
`;
    const errors = validateStaticMode(code, 'app/docs/[slug]/page.tsx', {
      clientJavascriptDisabled: false,
    });
    expect(errors).toHaveLength(0);
  });

  it('static mode allows use client in non-clientJavascript-disabled mode', () => {
    // In static mode without clientJavascript disabled, client components are valid —
    // they hydrate in the browser after static HTML is served
    const code = `'use client'
import { useState } from 'react'
export default function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}
`;
    const errors = validateStaticMode(code, 'app/counter.tsx', { clientJavascriptDisabled: false });
    expect(errors).toHaveLength(0);
  });

  it('cloudflare adapter produces static output directory', async () => {
    const buildDir = await createMockStaticBuildDir(tempDir);
    const adapter = cloudflare();
    const config: TimberConfig = { output: 'static' };

    await adapter.buildOutput(config, buildDir);

    const outDir = join(buildDir, 'cloudflare');
    const files = await readdir(outDir);
    expect(files).toContain('static');
    expect(files).toContain('_worker.js');
  });

  it('nitro adapter produces static output directory', async () => {
    const buildDir = await createMockStaticBuildDir(tempDir);
    const adapter = nitro({ preset: 'node-server' });
    const config: TimberConfig = { output: 'static' };

    await adapter.buildOutput(config, buildDir);

    const outDir = join(buildDir, 'nitro');
    const files = await readdir(outDir);
    expect(files).toContain('public');
    expect(files).toContain('entry.ts');
  });
});

// ─── clientJavascript disabled strips scripts ──────────────────────────────────────────────────

describe('clientJavascript disabled strips scripts', () => {
  it('buildClientScripts returns empty in clientJavascript disabled mode', () => {
    const result = buildClientScripts({
      output: 'static',
      clientJavascript: { disabled: true, enableHMRInDev: false },
      dev: false,
    });

    expect(result.bootstrapScriptContent).toBe('');
    expect(result.preloadLinks).toBe('');
  });

  it('buildClientScripts returns empty in clientJavascript disabled dev mode', () => {
    const result = buildClientScripts({
      output: 'static',
      clientJavascript: { disabled: true, enableHMRInDev: false },
      dev: true,
    });

    expect(result.bootstrapScriptContent).toBe('');
    expect(result.preloadLinks).toBe('');
  });

  it('non-clientJavascript-disabled static mode includes bootstrap scripts', () => {
    const result = buildClientScripts({
      output: 'static',
      clientJavascript: { disabled: false, enableHMRInDev: false },
      dev: false,
    });

    // Should have a bootstrap script (fallback path when no manifest)
    expect(result.bootstrapScriptContent).toBeTruthy();
    expect(result.bootstrapScriptContent).toContain('import(');
  });

  it('clientJavascript disabled mode with adapter gracefully handles missing client dir', async () => {
    // Build dir without client/ directory — clientJavascript disabled mode produces no JS
    const buildDir = join(tempDir, '.timber', 'build');
    const serverDir = join(buildDir, 'server');
    await mkdir(serverDir, { recursive: true });
    await writeFile(
      join(serverDir, 'entry.js'),
      'export const handler = async () => new Response("ok");'
    );

    // RSC and SSR bundles are still required
    const rscDir = join(buildDir, 'rsc');
    await mkdir(rscDir, { recursive: true });
    await writeFile(join(rscDir, 'index.js'), 'export default async (req) => new Response("ok");');

    const ssrDir = join(buildDir, 'ssr');
    await mkdir(ssrDir, { recursive: true });
    await writeFile(join(ssrDir, 'index.js'), '// ssr entry');

    const adapter = cloudflare();
    const config: TimberConfig = { output: 'static', clientJavascriptDisabled: true };

    // Should not throw even without client/ directory
    await adapter.buildOutput(config, buildDir);

    const outDir = join(buildDir, 'cloudflare');
    const files = await readdir(outDir);
    expect(files).toContain('_worker.js');
  });
});

// ─── clientJavascript disabled use client error ────────────────────────────────────────────────

describe('clientJavascript disabled use client error', () => {
  it("rejects 'use client' with single quotes", () => {
    const code = `'use client'
export default function Widget() { return <div /> }
`;
    const errors = detectDirectives(code, 'app/widget.tsx', { clientJavascriptDisabled: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('nojs-directive');
    expect(errors[0].message).toContain("'use client'");
    expect(errors[0].message).toContain('client JavaScript is disabled');
  });

  it("rejects 'use client' with double quotes", () => {
    const code = `"use client"
export default function Widget() { return <div /> }
`;
    const errors = detectDirectives(code, 'app/widget.tsx', { clientJavascriptDisabled: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('nojs-directive');
  });

  it("rejects 'use client' in deeply nested component", () => {
    const code = `'use client'
import { useState } from 'react'
export function DeepComponent() {
  const [state, setState] = useState(false)
  return <button onClick={() => setState(!state)}>Toggle</button>
}
`;
    const errors = detectDirectives(code, 'app/dashboard/settings/toggle.tsx', {
      clientJavascriptDisabled: true,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe('app/dashboard/settings/toggle.tsx');
  });

  it('provides line number for directive', () => {
    const code = `'use client'
export default function X() { return null }
`;
    const errors = detectDirectives(code, 'app/x.tsx', { clientJavascriptDisabled: true });
    expect(errors[0].line).toBe(1);
  });
});

// ─── clientJavascript disabled use server error ────────────────────────────────────────────────

describe('clientJavascript disabled use server error', () => {
  it("rejects module-level 'use server'", () => {
    const code = `'use server'
export async function createPost(formData) {
  await db.posts.create(formData)
}
`;
    const errors = detectDirectives(code, 'app/actions.ts', { clientJavascriptDisabled: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('nojs-directive');
    expect(errors[0].message).toContain("'use server'");
    expect(errors[0].message).toContain('client JavaScript is disabled');
  });

  it("rejects 'use server' with double quotes", () => {
    const code = `"use server"
export async function deletePost(id) { await db.posts.delete(id) }
`;
    const errors = detectDirectives(code, 'app/actions.ts', { clientJavascriptDisabled: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('nojs-directive');
  });

  it('provides file path in error', () => {
    const code = `'use server'
export async function action() {}
`;
    const errors = detectDirectives(code, 'app/dashboard/actions.ts', {
      clientJavascriptDisabled: true,
    });
    expect(errors[0].file).toBe('app/dashboard/actions.ts');
  });
});

// ─── Hashed assets ────────────────────────────────────────────────────────

describe('hashed assets', () => {
  it('production buildClientScripts uses hashed URL from manifest', () => {
    const result = buildClientScripts({
      output: 'static',
      clientJavascript: { disabled: false, enableHMRInDev: false },
      dev: false,
      buildManifest: {
        css: {},
        js: { 'src/client/browser-entry.ts': '/assets/browser-entry-abc123.js' },
        modulepreload: { 'src/client/browser-entry.ts': ['/assets/react-vendor-def456.js'] },
        fonts: {},
      },
    });

    // Uses hashed URL, not virtual path
    expect(result.bootstrapScriptContent).toBe('import("/assets/browser-entry-abc123.js")');
    expect(result.bootstrapScriptContent).not.toContain('virtual:');
    expect(result.preloadLinks).toContain('/assets/react-vendor-def456.js');
  });

  it('modulepreload hints use hashed URLs', () => {
    const result = buildClientScripts({
      output: 'server',
      clientJavascript: { disabled: false, enableHMRInDev: false },
      dev: false,
      buildManifest: {
        css: {},
        js: { 'src/client/browser-entry.ts': '/assets/entry-xyz.js' },
        modulepreload: {
          'src/client/browser-entry.ts': ['/assets/react-vendor-abc.js', '/assets/router-def.js'],
        },
        fonts: {},
      },
    });

    expect(result.preloadLinks).toContain(
      '<link rel="modulepreload" href="/assets/react-vendor-abc.js">'
    );
    expect(result.preloadLinks).toContain(
      '<link rel="modulepreload" href="/assets/router-def.js">'
    );
  });

  it('static assets are copied to adapter output', async () => {
    const buildDir = await createMockStaticBuildDir(tempDir);
    const adapter = cloudflare();

    await adapter.buildOutput({ output: 'static' }, buildDir);

    const staticAssets = join(buildDir, 'cloudflare', 'static', 'assets');
    const files = await readdir(staticAssets);
    // Verify hashed filenames in output
    expect(files.some((f) => /\w+-[a-z0-9]+\.js$/.test(f))).toBe(true);
    expect(files.some((f) => /\w+-[a-z0-9]+\.css$/.test(f))).toBe(true);
  });
});

// ─── Combined validation ──────────────────────────────────────────────────

describe('combined static validation', () => {
  it('dynamic APIs rejected in static mode', () => {
    const code = `
import { cookies } from '@timber-js/app/server'
export default async function Page() {
  const session = cookies().get('session')
  return <div>{session?.value}</div>
}
`;
    const errors = validateStaticMode(code, 'app/page.tsx', { clientJavascriptDisabled: false });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('dynamic-api');
    expect(errors[0].message).toContain('cookies()');
    expect(errors[0].message).toContain('static mode');
  });

  it('headers() rejected in static mode', () => {
    const code = `
import { headers } from '@timber-js/app/server'
export default async function Page() {
  const host = headers().get('host')
  return <div>{host}</div>
}
`;
    const errors = validateStaticMode(code, 'app/page.tsx', { clientJavascriptDisabled: false });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].type).toBe('dynamic-api');
    expect(errors[0].message).toContain('headers()');
  });

  it('clientJavascript disabled mode catches both directive and dynamic API errors', () => {
    const code = `'use client'
import { cookies } from '@timber-js/app/server'
export default function Page() {
  const session = cookies().get('session')
  return <div>{session}</div>
}
`;
    const errors = validateStaticMode(code, 'app/page.tsx', { clientJavascriptDisabled: true });
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const types = errors.map((e) => e.type);
    expect(types).toContain('nojs-directive');
    expect(types).toContain('dynamic-api');
  });

  it('line numbers are provided for errors', () => {
    const code = `
import { cookies } from '@timber-js/app/server'

export default async function Page() {
  const session = cookies().get('session')
  return <div>{session?.value}</div>
}
`;
    const errors = detectDynamicApis(code, 'app/page.tsx');
    expect(errors[0].line).toBeDefined();
    expect(errors[0].line).toBeGreaterThan(0);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────

async function createMockStaticBuildDir(baseDir: string): Promise<string> {
  const buildDir = join(baseDir, '.timber', 'build');

  const serverDir = join(buildDir, 'server');
  await mkdir(serverDir, { recursive: true });
  await writeFile(
    join(serverDir, 'entry.js'),
    'export const handler = async () => new Response("ok");'
  );

  // RSC and SSR bundles (copied by cloudflare adapter)
  const rscDir = join(buildDir, 'rsc');
  await mkdir(rscDir, { recursive: true });
  await writeFile(join(rscDir, 'index.js'), 'export default async (req) => new Response("ok");');

  const ssrDir = join(buildDir, 'ssr');
  await mkdir(ssrDir, { recursive: true });
  await writeFile(join(ssrDir, 'index.js'), '// ssr entry');

  const clientDir = join(buildDir, 'client');
  const assetsDir = join(clientDir, 'assets');
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(assetsDir, 'entry-abc123.js'), '// browser entry');
  await writeFile(join(assetsDir, 'styles-def456.css'), '/* styles */');

  return buildDir;
}
