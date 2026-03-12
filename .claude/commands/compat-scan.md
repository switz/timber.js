Run the Next.js compat test suite and file lb issues for regressions.

## Workflow

1. **Read baseline**: `tests/nextjs-compat/TRACKING.md` (if it exists) — map of test → {PASS, SKIP, N/A}

2. **Run tests**:
   ```bash
   pnpm test tests/nextjs-compat/
   ```

3. **Classify each result**:
   - **Regression** (was PASS, now FAIL) → file P1 lb issue
   - **Expected timber divergence** (intentional design difference) → note only
   - **New pass** (was SKIP/FAIL, now PASS) → comment on associated lb issue
   - **Untracked** (no TRACKING.md entry) → file P3 lb issue to categorize

4. **Print report** with counts per category

## Rules
- Deduplicate: `lb list` before every `lb create`
- Don't update TRACKING.md — that's a human decision
- Count at individual test level, not file level
