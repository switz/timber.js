#!/usr/bin/env node

/**
 * timber.js build performance benchmarks
 *
 * Measures:
 * - Cold build time (full RSC → SSR → Client → Manifest pipeline)
 * - Build output size (client JS/CSS, server JS)
 *
 * Usage:
 *   node benchmarks/run.js              # Run with defaults (3 runs)
 *   node benchmarks/run.js --runs 5     # Average over 5 runs
 *   node benchmarks/run.js --json       # JSON output only
 */

import { execFileSync } from 'node:child_process';
import { readdir, stat, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixture');
const BUILD_SCRIPT = resolve(import.meta.dirname, 'build-once.js');
const DIST_DIR = resolve(FIXTURE_DIR, 'dist');

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    json: { type: 'boolean', default: false },
  },
});

const NUM_RUNS = Math.max(1, parseInt(args.runs, 10));
const JSON_ONLY = args.json;

function log(msg) {
  if (!JSON_ONLY) process.stdout.write(msg + '\n');
}

async function measureBuild() {
  await rm(DIST_DIR, { recursive: true, force: true });

  const start = performance.now();
  execFileSync(process.execPath, [BUILD_SCRIPT], {
    cwd: FIXTURE_DIR,
    stdio: 'pipe',
    env: process.env,
  });
  return performance.now() - start;
}

async function measureOutputSize(dir) {
  const result = { totalBytes: 0, categories: {} };

  async function walk(currentDir) {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const info = await stat(fullPath);
        const relPath = relative(dir, fullPath);
        const ext = entry.name.split('.').pop() || '';

        let category = 'other';
        if (relPath.startsWith('client/')) {
          category = ext === 'css' ? 'client_css' : 'client_js';
        } else if (relPath.startsWith('rsc/')) {
          category = 'rsc_js';
        } else if (relPath.startsWith('ssr/')) {
          category = 'ssr_js';
        }

        result.totalBytes += info.size;
        result.categories[category] = (result.categories[category] || 0) + info.size;
      }
    }
  }

  await walk(dir);
  return result;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function main() {
  log('timber.js build benchmarks');
  log(`fixture: benchmarks/fixture/`);
  log(`runs: ${NUM_RUNS}\n`);

  const buildTimes = [];
  for (let i = 0; i < NUM_RUNS; i++) {
    log(`  run ${i + 1}/${NUM_RUNS}...`);
    const elapsed = await measureBuild();
    buildTimes.push(elapsed);
    log(`  ${formatMs(elapsed)}`);
  }

  const sizeResult = await measureOutputSize(DIST_DIR);

  const medianBuild = median(buildTimes);
  const minBuild = Math.min(...buildTimes);
  const maxBuild = Math.max(...buildTimes);

  const output = {
    benchmark: 'timber-build',
    timestamp: new Date().toISOString(),
    runs: NUM_RUNS,
    build: {
      cold_build_ms: {
        median: Math.round(medianBuild),
        min: Math.round(minBuild),
        max: Math.round(maxBuild),
        values: buildTimes.map((t) => Math.round(t)),
      },
    },
    output_size: {
      total_bytes: sizeResult.totalBytes,
      categories: sizeResult.categories,
    },
  };

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    log('\n--- Results ---\n');
    log(`Cold build time (median of ${NUM_RUNS}): ${formatMs(medianBuild)}`);
    log(`  min: ${formatMs(minBuild)}, max: ${formatMs(maxBuild)}`);
    log(`  all: [${buildTimes.map(formatMs).join(', ')}]`);
    log('');
    log(`Build output size: ${formatBytes(sizeResult.totalBytes)}`);
    for (const [cat, bytes] of Object.entries(sizeResult.categories)) {
      log(`  ${cat}: ${formatBytes(bytes)}`);
    }
    log('\nJSON:');
    log(JSON.stringify(output, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
