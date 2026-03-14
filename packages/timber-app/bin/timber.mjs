#!/usr/bin/env node
// Thin CLI wrapper — delegates to the compiled CLI entry.
// This file is the bin entry point and never moves, regardless of build output changes.
// See design/28-npm-packaging.md §"CLI Binary".
import '../dist/cli.js';
