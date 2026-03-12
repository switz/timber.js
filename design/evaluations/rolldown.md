# Evaluation: Rolldown as Replacement for Rollup

**Task:** TIM-182
**Date:** 2026-03-10
**Status:** No action required — Vite 8 handles this automatically

---

## Summary

Rolldown replaces Rollup inside Vite 8 (currently beta.18). When timber.js upgrades from Vite 7 to Vite 8, rolldown adoption happens automatically with no timber.js code changes required. There is no reason to adopt rolldown independently.

---

## Current State

### Rolldown
- **Rolldown 1.0 RC** shipped January 21, 2026 (rc.4 as of March 2026)
- Rust-based Rollup replacement, API-compatible with Rollup's plugin interface
- Passes 900+ Rollup tests and 670+ esbuild tests
- Built-in minification still in alpha

### Vite 8
- **Vite 8 beta** shipped December 3, 2025 (beta.18 as of March 9, 2026)
- Replaces both esbuild and Rollup with Rolldown as the single bundler
- Production build speedups: 3x–16x faster, up to 100x less memory
- No stable release date announced yet

### timber.js
- Currently on **Vite 7.3.1**
- Rollup is used only as a transitive dependency — zero direct rollup imports
- The only rollup plugin is `@mdx-js/rollup`, loaded dynamically by `timber-mdx`

---

## Impact on timber.js

### What changes automatically (Vite 8 upgrade)
- Rollup replaced by Rolldown under the hood — faster builds, less memory
- No changes to timber.js plugin code (sub-plugins use Vite's plugin API, not Rollup's directly)
- RSC via `@vitejs/plugin-rsc` works with Rolldown (confirmed by other frameworks)

### What may need attention
1. **`@mdx-js/rollup` moduleType**: Rolldown infers module type from file extension. The `@mdx-js/rollup` transform hook converts `.mdx` → JS but may need to return `moduleType: 'js'` in the result object. This is likely fixed upstream before Vite 8 stabilizes, but worth testing.

2. **Hook execution order**: Rolldown calls `outputOptions` before build hooks (opposite of Rollup). timber.js doesn't use `outputOptions` directly, so no impact expected.

3. **Transform hook timing**: Rolldown runs transform hooks before its internal TS/JSX transform. timber.js sub-plugins that transform code should handle TS/JSX syntax in input. This is already the case since Vite's transform pipeline handles this.

### What does NOT change
- Plugin architecture (sub-plugin array, shared context)
- Virtual module resolution
- Entry generation (real TypeScript files, not codegen)
- Dev server HMR wiring
- Build pipeline sequence (RSC → SSR → Client → Manifest → Adapter)

---

## Recommendation

**Do nothing now. Upgrade to Vite 8 when it reaches stable.**

1. Rolldown adoption is a Vite concern, not a timber.js concern
2. Zero timber.js source files import from rollup directly
3. The `@mdx-js/rollup` compatibility issue (if any) will be resolved upstream
4. No performance-critical build bottleneck justifies early adoption risk

### Pre-upgrade checklist (when Vite 8 stabilizes)
- [ ] Install `vite@8` and run full test suite
- [ ] Verify MDX compilation works (test with `.mdx` pages and content collections)
- [ ] Verify `@vitejs/plugin-rsc` compatibility with Vite 8
- [ ] Benchmark build times against Vite 7 baseline
- [ ] Check all sub-plugin hooks still fire in expected order

### Optional: Early validation
If desired, `rolldown-vite` (npm package) can be used to test timber.js against the Vite 8 engine on a branch without committing to the upgrade. This is low-priority since Vite 8 beta is still evolving.
