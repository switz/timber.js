Run the Next.js compat test suite and file bd issues for regressions.

## Workflow

1. **Read baseline**: `tests/nextjs-compat/TRACKING.md` (if it exists) — map of test → {PASS, SKIP, N/A}

2. **Run tests**:
   ```bash
   pnpm test tests/nextjs-compat/
   ```

3. **Classify each result**:
   - **Regression** (was PASS, now FAIL) → file P1 bd issue
   - **Expected timber divergence** (intentional design difference) → note only
   - **New pass** (was SKIP/FAIL, now PASS) → comment on associated bd issue
   - **Untracked** (no TRACKING.md entry) → file P3 bd issue to categorize

4. **Print report** with counts per category

## Rules
- Deduplicate: `bd search` before every `bd create`
- Don't update TRACKING.md — that's a human decision
- Count at individual test level, not file level
