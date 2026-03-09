Fix GitHub issue #$ARGUMENTS.

## Step 1: Understand the issue

Run `gh issue view $ARGUMENTS` to read the issue. Understand what's expected, what's broken, and any reproduction steps.

## Step 2: Create branch

```bash
git checkout -b fix/$ARGUMENTS-<slug>
```

Install dependencies if needed: `pnpm install`

## Step 3: Research before coding

1. Read relevant design documents in `design/`
2. Check existing code to understand the problem area
3. Check `design/13-security.md` if the change touches request handling

## Step 4: Write tests first

Add test cases before implementing. Run to confirm they fail: `pnpm test tests/<relevant>.test.ts`

## Step 5: Implement and verify

```bash
pnpm test tests/<relevant>.test.ts && pnpm run typecheck && pnpm run lint
```

## Step 6: Commit and create PR

```bash
git push -u origin fix/$ARGUMENTS-<slug>
gh pr create --title "fix: <description>" --base main --body "Fixes #$ARGUMENTS

## Summary
<what changed and why>

## Test plan
<tests added/updated>"
```

Print the PR URL when done.
