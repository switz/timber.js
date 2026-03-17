import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const PKG_DIR = resolve(import.meta.dirname, '../packages/timber-app');
const DIST_DIR = join(PKG_DIR, 'dist');

// All public entry points that must exist after build
const ENTRY_POINTS = [
  'index',
  'server/index',
  'client/index',
  'cache/index',
  'content/index',
  'search-params/index',
  'routing/index',
  'adapters/cloudflare',
  'adapters/nitro',
  'cli',
];

describe('npm packaging', () => {
  describe('package.json structure', () => {
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf-8'));

    it('has type: module', () => {
      expect(pkg.type).toBe('module');
    });

    it('has files field limiting published content', () => {
      expect(pkg.files).toBeDefined();
      expect(pkg.files).toContain('dist');
      expect(pkg.files).toContain('bin');
      // src/ is included because runtime entries (rsc-entry, ssr-entry,
      // browser-entry) import virtual modules and must be transpiled by
      // Vite at runtime — they cannot be pre-compiled.
      expect(pkg.files).toContain('src');
    });

    it('has bin pointing to the CLI wrapper', () => {
      expect(pkg.bin.timber).toBe('./bin/timber.mjs');
    });

    it('has build script using vite library mode', () => {
      expect(pkg.scripts.build).toContain('vite build');
      expect(pkg.scripts.build).toContain('--config vite.lib.config.ts');
    });

    it('has prepublishOnly script', () => {
      expect(pkg.scripts.prepublishOnly).toBeDefined();
    });

    it('pins @vitejs/plugin-rsc to patch range', () => {
      expect(pkg.dependencies['@vitejs/plugin-rsc']).toMatch(/^~0\.5\./);
    });

    it('has conditional exports with types + import', () => {
      // Every export should have types + import conditions
      for (const [key, value] of Object.entries(pkg.exports)) {
        if (key === './package.json') {
          expect(value).toBe('./package.json');
          continue;
        }
        const exp = value as { types: string; import: string };
        expect(exp.types).toMatch(/^\.\/dist\/.*\.d\.ts$/);
        expect(exp.import).toMatch(/^\.\/dist\/.*\.js$/);
      }
    });

    it('exports adapters as named entries, not wildcard', () => {
      expect(pkg.exports['./adapters/*']).toBeUndefined();
      expect(pkg.exports['./adapters/cloudflare']).toBeDefined();
      expect(pkg.exports['./adapters/nitro']).toBeDefined();
    });

    it('exposes ./package.json export', () => {
      expect(pkg.exports['./package.json']).toBe('./package.json');
    });
  });

  describe('CLI wrapper', () => {
    const binPath = join(PKG_DIR, 'bin/timber.mjs');

    it('exists', () => {
      expect(existsSync(binPath)).toBe(true);
    });

    it('has shebang', () => {
      const content = readFileSync(binPath, 'utf-8');
      expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
    });

    it('is executable', () => {
      const stat = statSync(binPath);
      // Check owner execute bit
      expect(stat.mode & 0o100).toBeTruthy();
    });

    it('imports from dist/cli.js', () => {
      const content = readFileSync(binPath, 'utf-8');
      expect(content).toContain("'../dist/cli.js'");
    });
  });

  describe('vite.lib.config.ts', () => {
    const configPath = join(PKG_DIR, 'vite.lib.config.ts');

    it('exists', () => {
      expect(existsSync(configPath)).toBe(true);
    });

    it('defines all entry points', () => {
      const content = readFileSync(configPath, 'utf-8');
      for (const entry of ENTRY_POINTS) {
        // Check the entry value (src path) is referenced
        const srcPath = entry === 'cli' ? 'src/cli.ts' : `src/${entry}.ts`;
        expect(content).toContain(srcPath);
      }
    });

    it('externalizes peer and direct dependencies', () => {
      const content = readFileSync(configPath, 'utf-8');
      const requiredExternals = [
        'react',
        'react-dom',
        'vite',
        'nuqs',
        'zod',
        '@vitejs/plugin-rsc',
        '@vitejs/plugin-react',
        '@opentelemetry/api',
      ];
      for (const dep of requiredExternals) {
        expect(content).toContain(`'${dep}'`);
      }
      // Node.js builtins via regex
      expect(content).toContain('node:');
    });
  });

  describe('build output', () => {
    beforeAll(() => {
      // Run the build from the package directory
      execSync('pnpm run build', { cwd: PKG_DIR, stdio: 'pipe', timeout: 60_000 });
    }, 120_000);

    it('produces dist/ directory', () => {
      expect(existsSync(DIST_DIR)).toBe(true);
    });

    for (const entry of ENTRY_POINTS) {
      it(`produces JS output for ${entry}`, () => {
        expect(existsSync(join(DIST_DIR, `${entry}.js`))).toBe(true);
      });

      it(`produces declaration file for ${entry}`, () => {
        // The declaration file path follows the source structure
        const dtsPath = entry === 'cli' ? 'cli.d.ts' : `${entry}.d.ts`;
        expect(existsSync(join(DIST_DIR, dtsPath))).toBe(true);
      });
    }

    it('produces sourcemaps', () => {
      expect(existsSync(join(DIST_DIR, 'index.js.map'))).toBe(true);
    });

    it('JS output is valid ESM (has export)', () => {
      const indexJs = readFileSync(join(DIST_DIR, 'index.js'), 'utf-8');
      expect(indexJs).toMatch(/export\s/);
    });

    it('JS output does not bundle React', () => {
      const indexJs = readFileSync(join(DIST_DIR, 'index.js'), 'utf-8');
      // Should import from react, not inline it
      expect(indexJs).not.toContain('function createElement');
    });

    it('CLI output is valid ESM', () => {
      const cliJs = readFileSync(join(DIST_DIR, 'cli.js'), 'utf-8');
      expect(cliJs).toMatch(/export\s/);
    });
  });
});
