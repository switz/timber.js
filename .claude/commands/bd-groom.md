Run the timber.js backlog grooming sweep — stale issues, duplicates, design contradictions, dep graph health.

Read `design/` docs before running check 3.

## Check 1: Stale in-progress issues

```bash
lb list --status in_progress --json
```

For each in-progress issue, check `updated_at`. If stale (>7 days, no recent PR/commit activity), reset to open:

```bash
lb update <id> --status open --json
```

## Check 2: Duplicate detection

```bash
lb dedupe --json
```

Verify each pair manually. Only close confirmed duplicates (same root problem, fixing one fixes the other). Close the later-created issue.

## Check 3: Design contradiction scan

Read design docs, then scan for prohibited patterns in open issues:

- ISR / incremental static regeneration (`06-caching.md`)
- Implicit fetch caching (`06-caching.md`)
- `loading.tsx` auto-insertion (timber never auto-inserts Suspense)
- HTTP 200 before outcome known (`01-philosophy.md`)
- Global `middleware.ts` (`07-routing.md`)
- Pages router (timber is App Router only)
- SlotAccessContext (`04-authorization.md` — single AccessContext)

Flag with a comment — do NOT close.

## Check 4: Dependency graph health

- Dependencies on closed issues → comment
- Priority inversions (child lower priority than parent) → comment
- P3/P4 blocking P1/P2 → comment on the blocker

## Final report

Print counts for every action taken across all checks.
