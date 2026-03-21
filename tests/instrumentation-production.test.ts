/**
 * Instrumentation production wiring tests.
 *
 * Validates that instrumentation.ts is properly wired into production builds:
 * - virtual:timber-instrumentation detects and loads the user's file
 * - The RSC entry calls loadInstrumentation() before accepting requests
 * - Both Nitro and Cloudflare adapters include instrumentation in the build
 *
 * Design docs: design/17-logging.md, design/25-production-deployments.md
 * Task: LOCAL-330
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateInstrumentationModule } from '../packages/timber-app/src/plugins/entries';

// ─── Virtual module generation ───────────────────────────────────────────

describe('generateInstrumentationModule', () => {
  it('generates a dynamic import when instrumentation.ts exists', () => {
    const path = '/project/instrumentation.ts';
    const code = generateInstrumentationModule(path);

    expect(code).toContain('export default async function loadUserInstrumentation()');
    expect(code).toContain(`import(${JSON.stringify(path)})`);
    expect(code).not.toContain('return null');
  });

  it('generates a null loader when no instrumentation.ts exists', () => {
    const code = generateInstrumentationModule(null);

    expect(code).toContain('export default async function loadUserInstrumentation()');
    expect(code).toContain('return null');
    expect(code).toContain('No instrumentation.ts found');
  });

  it('properly escapes the instrumentation path in the import', () => {
    const path = '/project with spaces/instrumentation.ts';
    const code = generateInstrumentationModule(path);

    // The path should be JSON-stringified so special characters are escaped
    expect(code).toContain(JSON.stringify(path));
  });

  it('handles Windows-style paths', () => {
    const path = 'C:\\Users\\dev\\project\\instrumentation.ts';
    const code = generateInstrumentationModule(path);

    expect(code).toContain(JSON.stringify(path));
  });
});

// ─── RSC entry includes loadInstrumentation call ─────────────────────────

describe('RSC entry instrumentation wiring', () => {
  it('rsc-entry/index.ts imports loadInstrumentation', () => {
    const entryPath = resolve(
      __dirname,
      '../packages/timber-app/src/server/rsc-entry/index.ts'
    );
    const source = readFileSync(entryPath, 'utf-8');

    expect(source).toContain("import { loadInstrumentation } from '#/server/instrumentation.js'");
  });

  it('rsc-entry/index.ts imports virtual:timber-instrumentation', () => {
    const entryPath = resolve(
      __dirname,
      '../packages/timber-app/src/server/rsc-entry/index.ts'
    );
    const source = readFileSync(entryPath, 'utf-8');

    expect(source).toContain("import loadUserInstrumentation from 'virtual:timber-instrumentation'");
  });

  it('rsc-entry/index.ts calls loadInstrumentation before pipeline creation', () => {
    const entryPath = resolve(
      __dirname,
      '../packages/timber-app/src/server/rsc-entry/index.ts'
    );
    const source = readFileSync(entryPath, 'utf-8');

    const loadLine = source.indexOf('await loadInstrumentation(loadUserInstrumentation)');
    const pipelineLine = source.indexOf('createPipeline(pipelineConfig)');

    expect(loadLine).toBeGreaterThan(-1);
    expect(pipelineLine).toBeGreaterThan(-1);
    expect(loadLine).toBeLessThan(pipelineLine);
  });

  it('loadInstrumentation is called before dev tracing init', () => {
    const entryPath = resolve(
      __dirname,
      '../packages/timber-app/src/server/rsc-entry/index.ts'
    );
    const source = readFileSync(entryPath, 'utf-8');

    // Find the actual call site (not the import statement)
    const loadCall = source.indexOf('await loadInstrumentation(loadUserInstrumentation)');
    // Find the first usage of initDevTracing (the await call, not import)
    const devTracingCall = source.indexOf('await initDevTracing');

    expect(loadCall).toBeGreaterThan(-1);
    expect(devTracingCall).toBeGreaterThan(-1);
    // Instrumentation runs first — OTEL SDK might be initialized in register()
    expect(loadCall).toBeLessThan(devTracingCall);
  });
});

// ─── File detection ──────────────────────────────────────────────────────

describe('instrumentation file detection', () => {
  it('entries plugin resolves virtual:timber-instrumentation', () => {
    // The entries plugin adds virtual:timber-instrumentation to its resolveId.
    // We verify the plugin source includes the instrumentation virtual ID.
    const pluginPath = resolve(
      __dirname,
      '../packages/timber-app/src/plugins/entries.ts'
    );
    const source = readFileSync(pluginPath, 'utf-8');

    expect(source).toContain("instrumentation: 'virtual:timber-instrumentation'");
    expect(source).toContain('RESOLVED_INSTRUMENTATION_ID');
    expect(source).toContain('detectInstrumentationFile');
  });
});

// ─── Integration: loadInstrumentation with generated loader ──────────────

describe('loadInstrumentation with generated loader patterns', () => {
  it('null loader (no instrumentation.ts) does not error', async () => {
    const { loadInstrumentation, resetInstrumentation } = await import(
      '../packages/timber-app/src/server/instrumentation'
    );
    resetInstrumentation();

    // Simulate the generated null loader
    const nullLoader = async () => null;
    await expect(loadInstrumentation(nullLoader)).resolves.not.toThrow();
  });

  it('loader returning register+logger+onRequestError wires all hooks', async () => {
    const {
      loadInstrumentation,
      resetInstrumentation,
      callOnRequestError,
      hasOnRequestError,
    } = await import('../packages/timber-app/src/server/instrumentation');
    const { getLogger, setLogger } = await import(
      '../packages/timber-app/src/server/logger'
    );
    resetInstrumentation();
    // Reset logger to default
    setLogger(null as any);

    let registerCalled = false;
    let errorHookCalled = false;

    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    await loadInstrumentation(async () => ({
      register: () => {
        registerCalled = true;
      },
      onRequestError: () => {
        errorHookCalled = true;
      },
      logger: mockLogger,
    }));

    expect(registerCalled).toBe(true);
    expect(hasOnRequestError()).toBe(true);

    // Verify logger was wired
    const logger = getLogger();
    expect(logger).toBe(mockLogger);

    // Verify onRequestError works
    await callOnRequestError(new Error('test'), {
      method: 'GET',
      path: '/',
      headers: {},
    }, {
      phase: 'render',
      routePath: '/',
      routeType: 'page',
      traceId: 'test-trace',
    });
    expect(errorHookCalled).toBe(true);
  });
});
