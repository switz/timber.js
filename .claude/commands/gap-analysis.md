Run a comprehensive gap analysis of the timber.js codebase against its design docs, then file lb tasks for all gaps found.

## Phase 1: Read all design docs

Read every file in `design/` directory. For each design doc, extract:

- Every specified feature, API, behavior, or requirement
- Acceptance criteria or expected behavior descriptions
- Any explicitly stated implementation requirements

Build a checklist of everything the design docs promise.

## Phase 2: Scan the implementation

Explore `packages/timber-app/src/` thoroughly:

1. **Exports and APIs**: Check what's actually exported from each module. Compare against design doc API surfaces.
2. **TODOs and stubs**: Search for `TODO`, `FIXME`, `not implemented`, `stub`, `placeholder`, `noop`, empty function bodies, functions that just `throw`.
3. **Partial implementations**: Look for functions that exist but have incomplete logic — early returns, missing branches, hardcoded values where dynamic behavior is specified.
4. **Shims coverage**: Check `shims/` against what Next.js APIs the design docs say we reimplement. Identify any shims that are missing or incomplete.

## Phase 3: Check test coverage

1. Read `FEATURES.md` to see what's claimed as implemented.
2. List all test files in `tests/` and `tests/e2e/`.
3. Cross-reference: which claimed features have tests? Which don't?
4. Look for skipped tests (`it.skip`, `describe.skip`, `test.skip`, `xit`, `xdescribe`).
5. Identify design doc features with zero test coverage.

## Phase 4: Check existing lb issues

Run `lb list --json` to get all existing issues. Parse the output to understand what's already tracked. Avoid creating duplicates. Update existing issues with more detail if necessary.

## Phase 5: Categorize gaps

Organize findings into these categories:

### A. Not started — Design doc specifies it, no implementation exists

### B. Partially implemented — Code exists but is incomplete, stubbed, or doesn't match the design doc spec

### C. Implemented but untested — Feature appears to work but has no test coverage

### D. Production readiness gaps — Missing error handling, missing edge cases, hardcoded values, security gaps

For each gap, note:

- Which design doc specifies it (e.g., `design/07-routing.md`)
- What files are involved
- Severity: P0 (critical for production), P1 (important), P2 (normal), P3 (nice to have)

## Phase 6: File lb tasks

For each gap, create an lb task using the project's task template format:

```bash
lb create "Short descriptive title" \
  -d "$(cat <<'ENDDESC'
## Context

What exists today, what's missing, and why this task matters.
Reference the specific files/lines where the gap is.
Always cite design docs: design/NN-topic.md

## Approach Constraints

DO:
- Specific technical requirements
- Patterns to follow

DO NOT:
- Anti-patterns to avoid
- Scope boundaries

## Files

MODIFY: path/to/file.ts (what changes)
CREATE: tests/new-test.ts
READ-ONLY: design/relevant-doc.md
ENDDESC
)" \
  -p <priority> \
  --type <task|feature|bug> \
  --json
```

Group related small gaps into single tasks where it makes sense (e.g., "Complete next/navigation shim — missing redirect() and notFound()"). Don't create one task per missing line — use good judgment on task granularity.

## Phase 7: Summary report

After filing all tasks, produce a summary:

1. **Total gaps found** by category (A/B/C/D)
2. **Tasks created** with their IDs and titles
3. **Highest priority items** — what blocks production readiness
4. **Quick wins** — low-effort gaps that could be closed fast

## Rules

- **Design docs are the source of truth.** If code does something the design doc doesn't specify, that's not a gap — it's bonus. Only flag missing or wrong behavior.
- **Don't file duplicates.** Check `lb list` before creating any task.
- **Be specific.** Every task must cite the design doc section and the relevant source files.
- **Use appropriate priority.** P0 = security/correctness, P1 = core features, P2 = completeness, P3 = polish.
- **Group intelligently.** One task per logical unit of work, not one task per line of missing code.
