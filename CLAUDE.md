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
- **NEVER mention claude in commit messages** It's not necessary.

### PR Workflow

1. Create a branch: `git checkout -b fix/descriptive-name`
2. Make changes and commit (do not mention claude)
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

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Version-controlled: Built on Dolt with cell-level merge
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

**You MUST USE THE BD TASK TEMPLATE TO CREATE ISSUES**: [`./bd-task-template.md`](./bd-task-template.md)

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs with git:

- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- END BEADS INTEGRATION -->
