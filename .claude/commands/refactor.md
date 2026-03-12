Refactor code for cleanliness: DRY violations, shared module extraction, dead code removal, and file size enforcement (<500 lines excluding blanks/comments).

If $ARGUMENTS is set (a file path, directory, or glob pattern), refactor only that target. If empty, scan all files under `packages/timber-app/src/`.

## Rules

- **No behavior changes.** Only restructure code — observable behavior must stay identical.
- **Incremental commits.** Each logically independent refactor gets its own commit so failures are easy to revert.
- **Tests are the safety net.** Run verification after every change; revert and try a different approach if anything fails.

## Analysis phase

Scan the target files and identify:

1. **Oversized files** — Count non-blank, non-comment lines:
   ```bash
   awk '!/^[[:space:]]*$/ && !/^[[:space:]]*\/\//' <file> | wc -l
   ```
   Flag any file exceeding 500 lines (blank lines and comments don't count toward the limit).

2. **DRY violations** — Duplicate or near-duplicate code blocks across files (shared logic, repeated patterns, copy-pasted helpers).

3. **Extractable utilities** — Functions or constants that are used across multiple modules and belong in a shared location.

4. **Dead code** — Unused exports, unreachable branches, variables assigned but never read.

5. **Complexity** — Deeply nested conditionals, overly long functions, code that can be simplified without changing behavior.

Present findings to the user before making changes. Group by category and include file paths and line numbers.

## Refactoring phase

For each finding, in order of impact:

1. **Split oversized files** along natural seam lines (group of related functions, a distinct concern).
2. **Extract shared utilities** to the appropriate module (e.g., a `utils.ts` sibling or existing shared module).
3. **Deduplicate** by importing from the shared location.
4. **Simplify** complex conditionals and reduce nesting.
5. **Remove dead code** — unused exports, unreachable branches, unused imports.

After each logically independent change:

### Verification

```bash
pnpm test
pnpm run typecheck
pnpm run lint
```

If any check fails:
1. Revert the change (`git checkout -- .`)
2. Try a different decomposition approach
3. If the refactor cannot be done safely, skip it and note why in the report

After verification passes, commit the change with a descriptive message.

## Reporting

After all refactoring is complete, summarize:

- Files touched and what changed in each
- Lines saved (before vs. after non-blank/non-comment counts)
- Modules extracted or created
- Dead code removed
- Any findings that were skipped and why
- Final test/typecheck/lint status
