Scan recent bug-fix and security-patch commits from Vinext and Next.js, then analyze whether timber.js (an independent implementation operating in the same design space) is exposed to the same vulnerability classes. Do NOT file lb issues or make code changes — present findings as integration questions for the user to decide on.

$ARGUMENTS is an optional commit count (default: 50).

## Design authority

Read these design docs before analyzing any fix — they define what timber does and does not share with upstream:

- `01-philosophy.md` — HTTP correctness, no pages router, no ISR
- `02-rendering-pipeline.md` — single `renderToReadableStream`, flush at `onShellReady`, debug channel sink
- `05-streaming.md` — explicit streaming boundaries, Suspense semantics
- `06-caching.md` — `timber.cache()`, no patched fetch, SHA-256 keys
- `07-routing.md` — `proxy.ts`, per-route middleware, URL canonicalization, no regex matchers
- `08-forms-and-actions.md` — CSRF, redirect restrictions, FormData limits
- `10-error-handling.md` — error boundary rendering, `dangerouslyPassData`
- `13-security.md` — full vulnerability taxonomy and test checklist
- `18-build-system.md` — Vite plugin array, virtual modules, entry generation
- `19-client-navigation.md` — segment router, prefetch cache

## Setup

```bash
git remote get-url vinext 2>/dev/null || git remote add vinext https://github.com/nickvdp/vinext.git
COMMIT_COUNT="${ARGUMENTS:-50}"
```

## Step 1: Gather bug-fix commits

### vinext

```bash
git fetch vinext main
git log vinext/main -${COMMIT_COUNT} --oneline --grep="fix" --grep="patch" --grep="security" --grep="CVE" --grep="bug" --grep="regression" --grep="revert"
```

Git `--grep` ORs multiple patterns by default. Deduplicate by SHA if needed.

### Next.js

Use the GitHub API — do not clone the repo:

```bash
gh api repos/vercel/next.js/commits \
  -q '.[] | select(.commit.message | test("^(fix|revert|security|patch|CVE|bug)"; "i")) | "\(.sha[0:10]) \(.commit.message | split("\n")[0])"' \
  --method GET -F per_page=100 -F sha=canary | head -${COMMIT_COUNT}
```

Also check recently merged bug PRs:

```bash
gh pr list --repo vercel/next.js --state merged --label bug --limit ${COMMIT_COUNT} \
  --json number,title,mergedAt,url --jq '.[] | "\(.number) \(.title)"'
```

## Step 2: Filter to relevant areas

For each candidate, check whether it touches code with a timber.js equivalent.

**Skip commits only touching:**

- `packages/next/src/client/components/pages-router/` (pages router)
- `packages/next/src/server/lib/incremental-cache/` (ISR)
- `packages/next/src/build/webpack/` (webpack-specific)
- `packages/next/src/cli/` (Next CLI)
- `packages/create-next-app/` (scaffolding)
- Turbopack-specific internals
- `test/` only (test-only changes with no production fix)

**Focus on commits touching:**

- `packages/next/src/server/app-render/` → maps to `src/server/`
- `packages/next/src/server/web/` → maps to Cloudflare adapter
- `packages/next/src/shared/lib/router/` → maps to `src/client/`
- `packages/next/src/server/lib/router-utils/` → maps to `src/routing/`
- `packages/next/src/server/future/route-modules/app-route/` → maps to `src/server/route-handler.ts`
- Server actions, CSRF, redirects, streaming, metadata, caching

For vinext: `git show --stat <sha>`. For Next.js: `gh api repos/vercel/next.js/commits/<sha> -q '.files[].filename'`.

## Step 3: Deep-analyze each relevant fix

For each fix that passed the filter:

1. **Read the full diff.** vinext: `git show <sha>`. Next.js: `gh api repos/vercel/next.js/commits/<sha> -q '.files[] | "--- \(.filename) ---\n\(.patch)"'`

2. **Identify the root cause.** What was the bug? What precondition triggers it? What is the failure mode (crash, wrong output, security bypass, data leak)?

3. **Search timber for the same pattern.** Run targeted searches and show the commands + results:

   ```bash
   # Example: race condition in RSC streaming
   rg "ReadableStream|pipeTo|pipeThrough" packages/timber-app/src/server/ --type ts -l

   # Example: redirect validation bypass
   rg "redirect|Location" packages/timber-app/src/server/ --type ts -C 3
   ```

4. **Classify:**
   - **VULNERABLE** — timber has the same code pattern and is likely affected
   - **UNCERTAIN** — timber has related code but the specific trigger path is unclear
   - **SAFE-BY-DESIGN** — timber's architecture inherently avoids this (e.g., no ISR, no regex matchers)
   - **NOT-APPLICABLE** — timber does not have the relevant feature

## Step 4: Formulate integration questions

For each VULNERABLE or UNCERTAIN finding, present a structured question block:

```
### [SEVERITY] <one-line description>

**Upstream:** <repo> <sha> — <commit subject>
**Root cause:** <2-3 sentences explaining the actual bug, not just what changed>
**Timber exposure:** <which timber files have similar patterns, with paths>

**Question:** <specific, actionable question>
  (a) Port this fix — adapt the upstream patch to timber's `<file>`
  (b) Verify not affected — write a test reproducing the upstream bug against timber
  (c) Skip — our architecture avoids this because <reason>
  (d) <any case-specific option>
```

## Step 5: Present report

Group findings by severity:

```
## Upstream Bug Watch — <date>
Sources: vinext/main (last N), vercel/next.js canary (last N)
Commits scanned: <total>
Bug-fix commits found: <count>
Relevant to timber: <count>

### Security (<count>)
<question blocks>

### Correctness (<count>)
<question blocks>

### Performance (<count>)
<question blocks>

### Developer Experience (<count>)
<question blocks>

### Safe by Design (<count>)
<one-liner per item — these validate where timber's architecture paid off>

### Not Applicable (<count>)
<one-liner per item>
```

## Severity classification

- **Security:** Authentication bypass, data leak, XSS, CSRF bypass, path traversal, cache poisoning, SSRF, open redirect, header injection
- **Correctness:** Wrong HTTP status codes, incorrect rendering, race conditions in streaming, data loss, state pollution across requests, hydration mismatches
- **Performance:** Memory leaks, unbounded growth, missing cleanup, excessive re-renders, streaming stalls
- **Developer Experience:** Misleading error messages, incorrect dev warnings, HMR failures, type errors in public API

## Rules

- **Read-only.** Do not create branches, file lb issues, or modify any code.
- **Show your work.** For each finding, show the specific search you ran against timber and what it returned.
- **No false positives.** If you cannot find the corresponding code pattern in timber, classify as NOT-APPLICABLE, not UNCERTAIN.
- **Link upstream.** Include the full commit SHA and a URL for every finding so the user can read the original fix.
- **Ask, don't prescribe.** The output is questions, not instructions. The user decides what to act on.
