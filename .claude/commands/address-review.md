Address review comments on PR #$ARGUMENTS.

## Step 1: Read all feedback

```bash
gh pr view $ARGUMENTS --comments
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/reviews
gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments
```

## Step 2: Categorize each comment

- **Fix needed**: Legitimate issue introduced by this PR. Fix it.
- **Out of scope / pre-existing**: Real problem but not from this PR. File a bd issue with `--deps discovered-from:<task-id>`.
- **Disagree**: Reply explaining why.

## Step 3: Make fixes

Work in the PR branch. After fixing:
```bash
pnpm test tests/<relevant>.test.ts && pnpm run typecheck && pnpm run lint
```
Commit and push.

## Step 4: Reply to comments

Confirm each fix with the commit SHA. For disagreements, reply with reasoning.

## Step 5: Enable auto-merge

```bash
gh pr merge $ARGUMENTS --auto --squash --delete-branch
```

## Summary

Print: comments addressed (with commits), bd issues filed, auto-merge status.
