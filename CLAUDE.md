# Agent Guidelines

Instructions for AI agents working on this codebase.

---

## Project Overview

**timber.js** (`@timber/app`) is a Vite-native React framework for Cloudflare Workers. It prioritizes correct HTTP semantics, real status codes, pages that work without JavaScript, and streaming only where explicitly requested.

### Design Docs

All design decisions are in [`design/`](design/README.md). **Read the relevant design doc before implementing any feature.** The docs are the source of truth for behavior, API surfaces, and architectural constraints.

---

## Quick Reference

### Commands

```bash
pnpm test                              # Vitest — full suite
pnpm test tests/plugin.test.ts         # Run a single test file
pnpm run test:e2e                      # Playwright E2E tests
pnpm run typecheck                     # TypeScript via tsgo
pnpm run lint                          # oxlint
```

### Project Structure

```
packages/timber-app/src/
  index.ts              # Main Vite plugin — returns array of sub-plugins
  plugins/              # Sub-plugins (shims, routing, entries, cache, fonts, mdx)
  shims/                # next/* module reimplementations
  server/               # RSC/SSR entry handlers, types
  client/               # Client navigation runtime, types
  cache/                # timber.cache + CacheHandler
  routing/              # File-system route scanner
  config/               # timber.config.ts loader
  adapters/             # Platform adapters

design/                 # 19 design docs — the source of truth
tests/                  # Vitest tests
tests/e2e/              # Playwright tests
tests/fixtures/         # Test apps
examples/               # User-facing demo apps
```

### Key Architectural Decisions

| Decision | Reference |
|----------|-----------|
| Plugin returns array of sub-plugins, not monolith | [18-build-system.md](design/18-build-system.md) |
| Entry modules are real TypeScript files, not codegen strings | [18-build-system.md](design/18-build-system.md) |
| No file >500 lines | [18-build-system.md](design/18-build-system.md) |
| Single `renderToReadableStream` call, flush held until `onShellReady` | [02-rendering-pipeline.md](design/02-rendering-pipeline.md) |
| `middleware(ctx: MiddlewareContext)` — one-arg signature | [07-routing.md](design/07-routing.md) |
| `GET(ctx: RouteContext)` — one-arg signature | [07-routing.md](design/07-routing.md) |
| Single `AccessContext` for segments and slots | [04-authorization.md](design/04-authorization.md) |
| `dangerouslyPassData` prop for RSC→client data in error/denial | [10-error-handling.md](design/10-error-handling.md) |

---

## Development Workflow

### Adding a New Feature

1. **Read the design doc** — find the relevant doc in `design/`
2. **Check Next.js tests** — search `test/e2e/` and `test/unit/` in the Next.js repo for related tests
3. **Add tests first** — put test cases in `tests/*.test.ts`
4. **Implement** — in the appropriate sub-plugin or module
5. **Run targeted tests** — don't run the full suite during dev

### Running Tests

**Always run targeted tests, not the full suite:**

```bash
pnpm test tests/plugin.test.ts         # Fast — seconds
pnpm test tests/cache-handler.test.ts  # Specific file
```

Let CI run the full suite.

### Searching the Next.js Test Suite

Required step for all feature work. Search for related tests:

```bash
gh search code "middleware" --repo vercel/next.js --filename "*.test.*" --limit 20
```

Port relevant test cases and link back:
```ts
// Ported from Next.js: test/e2e/app-dir/...
```

---

## Code Style & Dependencies

### Prefer Node.js Built-in APIs

Use Node.js built-ins before reaching for third-party packages:
- `node:crypto` `randomUUID()` for UUIDs
- `node:fs/promises` for async file operations
- `URL` and `URLSearchParams` for URL manipulation
- `structuredClone` for deep cloning

### No File >500 Lines

If a file approaches 500 lines, decompose it. This prevents god objects. **Comments and blank lines don't count toward the limit** — never trim comments or documentation to reduce line count.

---

## Git Workflow

- **NEVER push directly to main.** Always create a feature branch and open a PR.
- **NEVER use `gh pr merge --admin`.** If merge is blocked, investigate why.
- Branch protection: Lint, Typecheck, Vitest, Playwright E2E must pass.

### PR Workflow

1. Create a branch: `git checkout -b fix/descriptive-name`
2. Make changes and commit
3. Push: `git push -u origin fix/descriptive-name`
4. Open PR: `gh pr create`
5. Wait for CI, then merge: `gh pr merge --squash --delete-branch`

---

## Architecture & Gotchas

### RSC and SSR Are Separate Vite Environments

The RSC environment and SSR environment are **separate Vite module graphs with separate module instances**. Per-request state must be explicitly passed from RSC to SSR via `handleSsr(rscStream, navContext)`.

### Production Builds Require `createBuilder`

Use `createBuilder()` + `builder.buildApp()`, not `build()` directly.

### Virtual Module Resolution Quirks

- Build-time root prefix on virtual module IDs
- `\0` prefix in client environment
- All imports within virtual modules must use absolute paths

See [18-build-system.md](design/18-build-system.md) for details.

Avoid using python to run scripts. Lean on raw bash commands. If you really need a script, use javascript.
