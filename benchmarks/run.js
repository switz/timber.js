#!/usr/bin/env node

/**
 * timber.js build performance benchmarks
 *
 * Measures:
 * - Cold build time (full RSC → SSR → Client → Manifest pipeline)
 * - Build output size — raw and gzipped (total, by environment)
 * - Client bundle composition: react+dom, timber framework, app code
 *
 * Usage:
 *   node benchmarks/run.js              # Run with defaults (3 runs)
 *   node benchmarks/run.js --runs 5     # Average over 5 runs
 *   node benchmarks/run.js --json       # JSON output only
 */

import { execFileSync } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixture');
const BUILD_SCRIPT = resolve(import.meta.dirname, 'build-once.js');
const DIST_DIR = resolve(FIXTURE_DIR, 'dist');
const CLIENT_ANALYSIS = resolve(DIST_DIR, 'client-analysis.json');

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
  const result = {
    totalBytes: 0,
    totalGzipBytes: 0,
    categories: {},
    categoriesGzip: {},
  };

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
        if (entry.name === 'client-analysis.json') continue;
        const contents = await readFile(fullPath);
        const rawSize = contents.length;
        const gzipSize = gzipSync(contents, { level: 9 }).length;
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

        result.totalBytes += rawSize;
        result.totalGzipBytes += gzipSize;
        result.categories[category] = (result.categories[category] || 0) + rawSize;
        result.categoriesGzip[category] = (result.categoriesGzip[category] || 0) + gzipSize;
      }
    }
  }

  await walk(dir);
  return result;
}

/**
 * Read the client-analysis.json produced by the benchmark-analyze plugin.
 * Returns per-category (react, timber, app) byte totals based on
 * rendered module lengths and their proportion of each chunk's final size.
 */
async function measureClientComposition(distDir) {
  let analysis;
  try {
    analysis = JSON.parse(await readFile(CLIENT_ANALYSIS, 'utf8'));
  } catch {
    return null;
  }

  const totals = { react: 0, timber: 0, app: 0, other: 0 };
  const gzipTotals = { react: 0, timber: 0, app: 0, other: 0 };

  for (const [chunkPath, breakdown] of Object.entries(analysis)) {
    const fullPath = resolve(distDir, 'client', chunkPath);
    let contents;
    try {
      contents = await readFile(fullPath);
    } catch {
      continue;
    }
    const fileSize = contents.length;
    const gzipSize = gzipSync(contents, { level: 9 }).length;

    // Sum rendered module lengths to compute proportions
    const rendered = breakdown;
    const renderedTotal = rendered.react + rendered.timber + rendered.app + rendered.other;
    if (renderedTotal === 0) continue;

    for (const cat of ['react', 'timber', 'app', 'other']) {
      const ratio = rendered[cat] / renderedTotal;
      totals[cat] += Math.round(fileSize * ratio);
      gzipTotals[cat] += Math.round(gzipSize * ratio);
    }
  }

  return { totals, gzipTotals };
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
  const clientComp = await measureClientComposition(DIST_DIR);

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
      total_gzip_bytes: sizeResult.totalGzipBytes,
      categories: sizeResult.categories,
      categories_gzip: sizeResult.categoriesGzip,
    },
    client_composition: clientComp
      ? {
          bytes: clientComp.totals,
          gzip_bytes: clientComp.gzipTotals,
        }
      : null,
  };

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    log('\n--- Results ---\n');
    log(`Cold build time (median of ${NUM_RUNS}): ${formatMs(medianBuild)}`);
    log(`  min: ${formatMs(minBuild)}, max: ${formatMs(maxBuild)}`);
    log(`  all: [${buildTimes.map(formatMs).join(', ')}]`);
    log('');
    log(`Build output size: ${formatBytes(sizeResult.totalBytes)} (${formatBytes(sizeResult.totalGzipBytes)} gzip)`);
    for (const [cat, bytes] of Object.entries(sizeResult.categories)) {
      const gzBytes = sizeResult.categoriesGzip[cat] || 0;
      log(`  ${cat}: ${formatBytes(bytes)} (${formatBytes(gzBytes)} gzip)`);
    }
    if (clientComp) {
      log('');
      log('Client JS composition:');
      for (const cat of ['react', 'timber', 'app', 'other']) {
        if (clientComp.totals[cat] > 0) {
          log(`  ${cat}: ${formatBytes(clientComp.totals[cat])} (${formatBytes(clientComp.gzipTotals[cat])} gzip)`);
        }
      }
    }
    log('\nJSON:');
    log(JSON.stringify(output, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
