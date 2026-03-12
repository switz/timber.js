#!/usr/bin/env node

/**
 * Runs a single production build of the fixture app using createBuilder/buildApp.
 * Used by run.js to measure cold build time in a clean subprocess.
 */

import { createBuilder } from 'vite';
import { resolve } from 'node:path';

// Default to production — user can override via NODE_ENV
process.env.NODE_ENV ??= 'production';

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixture');

const builder = await createBuilder({
  configFile: resolve(FIXTURE_DIR, 'vite.config.ts'),
});
await builder.buildApp();
