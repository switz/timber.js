Timber.js Migration Retrospective & Fresh Start Analysis

 Context

 We're ~halfway through migrating timber.js from vinext scaffolding. The user wants to understand what
 went wrong and what we'd do differently if starting over.

 ---
 Current State Snapshot

 - 94 source files in packages/timber-app/src/, 31K lines total
 - Two monolithic files dominate: app-dev-server.ts (3,885 lines) and index.ts (2,301 lines)
 - ~50 commits on the timber branch across Phases 1-2
 - Phase 1 (core pipeline) mostly complete, Phase 2 (DX) partially started
 - 17 design docs covering every aspect of the framework

 ---
 Lessons Learned / What Went Wrong

 1. Copied Too Much, Too Early

 Problem: We migrated entire files from vinext wholesale (copy → modify) rather than rewriting against the
  design docs. This imported vinext's architectural decisions — decisions timber.js was supposed to
 replace.

 Example: app-dev-server.ts is 3,885 lines because it was copied from vinext's version, which combined RSC
  entry generation, SSR entry generation, browser entry generation, layout tree building, and route
 matching into one file. The design docs call for clean separation (rendering pipeline doc, routing doc)
 but the implementation carries vinext's monolithic structure.

 If starting over: Write each module fresh against the design doc, not by copying vinext code. Use vinext
 as reference only, never as starting point.

 2. The Vite Plugin (index.ts) Became a God Object

 Problem: 2,301 lines handling: shim resolution, virtual modules, font fetching/caching, PostCSS
 workarounds, MDX auto-detection, "use cache" transforms, config loading, and routing setup. This grew
 organically as features were added without decomposition.

 If starting over: Split the plugin into composable sub-plugins from day one:
 - timber-shims-plugin — next/* module resolution
 - timber-routing-plugin — virtual entry generation
 - timber-fonts-plugin — Google/local font handling
 - timber-cache-plugin — "use cache" transform
 - Core plugin coordinates them

 3. Server Entry Generation Is Stringly-Typed Code Generation

 Problem: app-dev-server.ts generates JavaScript source code as template strings that get loaded as
 virtual modules. 3,885 lines of string concatenation producing RSC entries, SSR entries, and browser
 entries. This is:
 - Impossible to type-check
 - Hard to debug (errors point to generated code, not source)
 - Tightly coupled (changing one import path requires updating string templates)

 If starting over: Consider a different architecture:
 - Use actual module files with dynamic imports rather than codegen
 - Or at minimum, use a proper template system with typed slots
 - Separate entry generation into distinct files (rsc-entry-generator.ts, ssr-entry-generator.ts,
 browser-entry-generator.ts)

 4. Premature Feature Breadth Over Depth

 Problem: We implemented many features at a surface level (access gates, status-code files, metadata,
 instrumentation, CLI, adapters, cache runtime, fonts, image optimization) before deeply testing and
 stabilizing the core rendering pipeline. Then we had to go back and audit (e.g., the cache-runtime audit
 in PR #28, the LayoutShell add-then-remove in PRs #26→#27).

 If starting over: Strict phase gates. Don't start Phase 2 features until Phase 1 has comprehensive test
 coverage and has been stabilized. The Phase 1 test suite (PR #16) came after most Phase 1 features were
 built.

 5. Design Docs Drifted from Implementation

 Problem: 17 design docs were written upfront, which is good. But implementation diverged in places
 without updating the docs. The cache audit (PR #28) was needed precisely because the cache-runtime.ts
 implementation didn't match the caching design doc.

 If starting over: Treat design docs as living specs. Every PR that deviates from a design doc must update
  that doc. Add a CI check or review step for this.

 6. Upstream Sync Overhead

 Problem: Maintaining packages/vinext/ as read-only scaffolding while building packages/timber-app/
 alongside it creates confusion. Cherry-picking upstream, triaging commits, maintaining merge logs — this
 is significant overhead that doesn't ship features.

 If starting over: Fork completely from day one. Don't maintain a parallel vinext package. Take what you
 need from vinext's code as reference, but don't try to keep a live upstream sync channel. The useful code
  can be cherry-picked once and then vinext is gone.

 7. Next.js Internal Path Shimming Is Brittle

 Problem: 10+ next/dist/* internal paths are shimmed for ecosystem library compat (next-intl,
 @clerk/nextjs, @sentry/nextjs). These break when Next.js refactors internals, and there's no test for
 detecting breakage.

 If starting over: Instead of shimming internal paths reactively:
 - Build an explicit compatibility layer per ecosystem library
 - Test against specific library versions in CI
 - Accept that some libraries won't work until they have official timber.js support

 8. Test Infrastructure Workarounds

 Problem: Ecosystem tests spawn subprocess Vite servers because "the RSC module runner in programmatic
 createServer() bypasses Vite's resolveId." This means test reliability depends on port availability,
 process cleanup, and connection timeouts.

 If starting over: Invest in proper test infrastructure first. Either:
 - Fix the programmatic API to respect resolveId (contribute upstream to Vite)
 - Build a test harness that abstracts the subprocess complexity
 - Use a request-level testing approach (send HTTP request → assert response) with a shared server
 lifecycle

 ---
 What Went Well

 1. Design docs are excellent — 17 docs covering philosophy through implementation details. The existence
 of these docs is the biggest asset.
 2. Adapter pattern is clean — TimberPlatformAdapter interface with Cloudflare and Node.js implementations
  is well-factored.
 3. Shims are mostly right — 46 shim files that individually are well-scoped and testable.
 4. Test coverage breadth — 69 test files covering routing, shims, server behavior, ecosystem compat.
 5. Upstream strategy — keeping vinext read-only for cherry-picks was the right call, even if the overhead
  was high.

 ---
 If Starting Over: Recommended Approach

 Architecture Changes

 1. Plugin composition — Main plugin is a factory that returns an array of focused sub-plugins
 2. No codegen for entries — Use actual TypeScript files with dynamic imports, configured via Vite's
 define or virtual config modules
 3. Server split — RSC entry, SSR entry, and browser entry as separate modules (not one 3,885-line
 generator)
 4. Cache as separate package — @timber/cache with its own tests, not entangled with the framework core

 Process Changes

 1. Tests before features — Write the test suite for each phase before implementing
 2. Phase gates — Complete stabilization of Phase N before starting Phase N+1
 3. Design doc CI — Each PR tagged with which design doc it implements; reviewer checks alignment
 4. No upstream sync — Fork once, take what you need, delete vinext immediately
 5. Ecosystem compat as opt-in plugins — @timber/compat-next-intl rather than shimming internal paths in
 core

 What to Keep

 1. All 17 design docs (updated to reflect lessons learned)
 2. The shim implementations (most are solid)
 3. The adapter interface
 4. The routing/app-router.ts scanner
 5. Test fixtures and ecosystem test patterns

 ---
 Restart Strategy

 Approach: New Sibling Repo

 Instead of reverting in-place, create a new sibling repo for timber.js:

 1. Export artifacts — Copy out of this repo into a standalone location:
   - timber.js/design/ (all 17 design docs)
   - This plan file (retrospective + issue template)
   - bd issue database (the issue definitions, AC, and design notes)
   - Key shim implementations as reference (not to copy wholesale)
 2. Revert this repo to upstream — git reset the timber branch back to main, or just abandon it. This repo
  stays as a clean vinext fork that can continue receiving upstream changes.
 3. Create timber-js sibling repo — Fresh repo, fresh structure:
   - packages/timber-app/ with the new decomposed architecture
   - Design docs copied in as the spec
   - bd database initialized with refined issues (using the new template)
   - No vinext scaffolding, no upstream sync machinery
 4. Hone the design — Before writing code:
   - Update design docs with lessons learned (this retrospective)
   - Rewrite all issues using the new template (context blocks, approach constraints, file manifests)
   - Identify which issues need spikes
   - Set phase gates with explicit exit criteria
 5. Then build — Test-first, one phase at a time, with the new process

 Why a New GitHub Repo (switz/timber-js)?

 - Clean git history — No 50 commits of false starts to confuse agents
 - No revert complexity — Fresh repo is cleaner than reverting 50 commits
 - Reference access — The old vinext fork stays archived; timber branch accessible if needed
 - Own identity — @timber/app gets its own npm scope, CI, deployment, issues
 - No upstream baggage — No vinext scaffolding, no sync machinery, no read-only constraints

 Post-Extraction: Archive vinext fork

 After extracting design docs, bd database, and reference code:
 - Archive the switz/vinext fork on GitHub (read-only)
 - The timber branch stays accessible for historical reference
 - No further upstream cherry-picks or sync work

 ---
 Execution Plan

 Step 1: Extract Artifacts from This Repo

 # Create staging directory
 mkdir -p ~/y/timber-js-staging

 # Copy design docs
 cp -r timber.js/design ~/y/timber-js-staging/design

 # Copy this plan/retrospective
 cp /Users/dsaewitz/.claude/plans/validated-mapping-plum.md ~/y/timber-js-staging/retrospective.md

 # Export bd database
 bd export --format jsonl > ~/y/timber-js-staging/issues.jsonl
 # Also copy raw beads db for import
 cp -r .beads ~/y/timber-js-staging/beads-backup

 # Copy reference files (NOT to use directly — just for looking at)
 mkdir -p ~/y/timber-js-staging/reference
 cp -r packages/timber-app/src/shims ~/y/timber-js-staging/reference/shims
 cp -r packages/timber-app/src/adapters ~/y/timber-js-staging/reference/adapters
 cp -r packages/timber-app/src/routing ~/y/timber-js-staging/reference/routing
 cp -r packages/timber-app/src/config ~/y/timber-js-staging/reference/config
 cp -r tests ~/y/timber-js-staging/reference/tests

 Step 2: Create New GitHub Repo

 cd ~/y
 gh repo create switz/timber-js --public --description "Vite-native React framework for Cloudflare
 Workers"
 git clone git@github.com:switz/timber-js.git
 cd timber-js

 # Initialize
 pnpm init
 # Set up monorepo structure, tsconfig, vitest, etc.

 Step 3: Bring In Design Docs

 cp -r ~/y/timber-js-staging/design ~/y/timber-js/design
 # Update design docs with retrospective findings (manual step)

 Step 4: Initialize bd & Rewrite Issues

 cd ~/y/timber-js
 bd init --prefix timber
 # Rewrite all issues using new template (context blocks, approach constraints, file manifests)
 # This is the most important step — don't rush it

 Step 5: Design Refinement (Before Any Code)

 - Update design docs with lessons learned
 - Identify spikes for uncertain architectural decisions
 - Define phase exit criteria for each epic
 - Get the issue template right on 2-3 issues, then batch the rest

 Step 6: Archive Vinext Fork

 # On GitHub: Settings → Archive repository (switz/vinext or the fork)
 # This makes it read-only but preserves all history including timber branch

 Step 7: Build (Finally)

 - Start with Phase 1, test-first
 - Use the new issue template and process
 - Phase gates enforced before moving on

 ---
 Issue Template for Agent Handoff

 Problem Statement

 The current bd issues have good acceptance criteria but lack the context agents need to build the right
 thing. Concrete failures:
 - LayoutShell (PRs #26→#27): Agent satisfied AC ("preserve layout state") by copying vinext's wrapper
 approach. Removed 2 commits later because React Flight already handles this. Missing: context about WHY
 the design doc chose differently.
 - Cache runtime (PR #28 audit): Agent built Phase 1 cache with vinext patterns (cacheLife, cacheTag,
 unstable_cache) that Phase 4 explicitly discards. Missing: awareness of future-phase constraints.
 - Monolith growth: No single issue caused app-dev-server.ts to reach 3,885 lines. Agents extend existing
 files by default. Missing: file boundary constraints.

 bd Capabilities We Can Leverage

 - --acceptance — structured acceptance criteria field
 - --design — design notes field (currently unused!)
 - --notes — additional notes field
 - bd lint — validates required sections exist (already checks for AC)
 - --validate — validation flag on create

 Proposed Issue Template

 For task and feature issues (the ones agents implement):

 # [Title]

 ## Context
 <!-- WHY this exists. Mental model, not implementation details. -->
 <!-- What trap will the agent fall into without this context? -->
 <!-- Link to specific design doc section. -->

 Design doc: timber.js/design/XX-name.md §"Section Name"

 [2-3 sentences explaining the mental model and the key insight
 that prevents the agent from doing the wrong thing.]

 Prior art: [relevant PRs, failed approaches, vinext patterns to avoid]

 ## Acceptance Criteria

 - [ ] Criterion 1 → `test: tests/foo.test.ts "test name"`
 - [ ] Criterion 2 → `test: tests/foo.test.ts "other test"`
 - [ ] Criterion 3 → `manual: curl localhost:5173/path, expect X`

 <!-- Each AC item has a verification method: test assertion or manual check -->

 ## Approach Constraints

 DO:
 - [Positive constraint — what the solution should look like]
 - [e.g., "Use React.cache() for request-scoped dedup"]

 DON'T:
 - [Negative constraint — what to avoid]
 - [e.g., "Don't copy vinext's implementation"]
 - [e.g., "Don't embed logic in app-dev-server.ts"]

 ## Files

 CREATE: src/server/segment-diff.ts (≤300 lines)
 CREATE: tests/segment-diff.test.ts
 MODIFY: src/server/app-dev-server.ts (import only)
 READ-ONLY: src/index.ts

 <!-- Max 500 lines per file. If exceeding, extract a module. -->

 For epic issues:

 # [Phase Name]

 ## Success Criteria
 <!-- High-level outcomes, not implementation details -->

 - [ ] Outcome 1 (verifiable)
 - [ ] Outcome 2 (verifiable)

 ## Scope Boundary

 IN SCOPE:
 - [what this phase covers]

 OUT OF SCOPE (future phases):
 - [what to explicitly NOT build yet]

 ## Architecture Constraints

 - [e.g., "No file >500 lines"]
 - [e.g., "All new server code in separate modules, not app-dev-server.ts"]

 How to Use with bd

 Creating an issue with the template:
 bd create "Segment tree diffing" \
   --description="$(cat <<'EOF'
 ## Context
 React Flight reconciles by component identity at each tree position.
 When a client navigates, skip re-rendering sync layouts already mounted.
 Vinext does NOT have this — this is new code, not a migration.

 Design doc: timber.js/design/02-rendering-pipeline.md §3.2 "Partial Payloads"
 Prior art: PR #26/#27 proved wrappers aren't needed — Flight handles identity.

 ## Approach Constraints

 DO:
 - New module for diffing logic — pure function (state tree + route → segments to render)
 - Write fresh against design doc, not vinext reference

 DON'T:
 - Embed diffing logic in app-dev-server.ts entry template strings
 - Add wrapper components for reconciliation

 ## Files

 CREATE: src/server/segment-diff.ts (≤200 lines)
 CREATE: tests/segment-diff.test.ts
 MODIFY: src/server/app-dev-server.ts (import only)
 EOF
 )" \
   --acceptance="$(cat <<'EOF'
 - [ ] Client sends X-Timber-State-Tree header → `test: tests/segment-diff.test.ts "sends state tree"`
 - [ ] Server skips sync layouts in client tree → `test: tests/segment-diff.test.ts "skips sync layouts"`
 - [ ] Async layouts always re-rendered → `test: tests/segment-diff.test.ts "re-renders async"`
 - [ ] Pages always re-rendered → `test: tests/segment-diff.test.ts "re-renders pages"`
 - [ ] middleware.ts + access.ts always run → `test: tests/segment-diff.test.ts "runs middleware"`
 - [ ] router.refresh() sends no state tree → `test: tests/segment-diff.test.ts "refresh full render"`
 EOF
 )" \
   --design="timber.js/design/02-rendering-pipeline.md §3.2" \
   -t task -p 2 --parent timber-3ok

 Validating issues:
 bd lint                    # Check all open issues for required sections
 bd lint --type task        # Check only tasks

 CLAUDE.md Addition

 Add to the "Issue Tracking with bd" section:

 ### Issue Template Requirements

 **All task/feature issues MUST include:**

 1. **Context block** — Why this exists, what mental model the agent needs, what trap to avoid, link to
 design doc section
 2. **Acceptance criteria with verification** — Each AC item maps to a test assertion (`test: file
 "name"`) or manual check (`manual: description`)
 3. **Approach constraints** — DO/DON'T lists preventing known failure modes (copying vinext, extending
 monoliths, over-engineering)
 4. **File manifest** — Which files to CREATE/MODIFY/READ-ONLY, with line budgets (max 500 lines per file)

 **Epics MUST include:**
 1. **Success criteria** — High-level verifiable outcomes
 2. **Scope boundary** — IN SCOPE / OUT OF SCOPE to prevent premature feature breadth
 3. **Architecture constraints** — Structural rules for the phase

 **Rule of thumb:** If an issue has >5 AC items, it should probably be split. If it touches core
 architecture, it needs a spike issue first.

 Spike Protocol

 For architecturally uncertain work, create two linked issues:

 # 1. Spike (timeboxed research, output is a finding)
 bd create "spike: Validate Flight handles layout identity without wrapper" \
   --description="Timeboxed to 1 hour. Output: yes/no finding + evidence." \
   -t task -p 1 --estimate 60

 # 2. Implementation (only created after spike confirms approach)
 bd create "Implement segment tree diffing" \
   --description="..." \
   -t task -p 2 --deps "timber-xxx"  # depends on spike