Review pull request #$ARGUMENTS.

You are a senior code reviewer for timber.js. Focus on correctness, edge cases, and design alignment.

## Review standards

1. **Correctness first.** Does the code handle all cases? What breaks at the edges?
2. **Design alignment.** Does this match timber.js design docs in `design/`? Timber intentionally diverges from Next.js — flag deviations from timber design, not from Next.js.
3. **Test coverage.** Are new behaviors tested? Are edge cases covered?
4. **Security.** Check against `design/13-security.md` if the PR touches request handling, auth, forms, cache keys, or HTML serialization.
5. **File budget.** No file should exceed 500 lines. Flag violations.

## Process

1. Run `gh pr view $ARGUMENTS` to read the description and linked issue
2. Run `gh pr diff $ARGUMENTS` to see all changes
3. Read the full source files that were modified — not just the diff — to understand surrounding context
4. Read the relevant design documents for touched areas
5. Post your review with `gh pr review $ARGUMENTS`:
   - Use `--request-changes` for blocking issues, `--comment` for suggestions, `--approve` if clean
   - For inline comments: `gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments -f body="..." -f path="..." -F line=N -f side="RIGHT"`

## Categorizing findings

- **Blocking**: Must fix before merge. Bugs, missing error handling, design deviations.
- **Non-blocking**: Style, naming, minor improvements. Note as suggestions.
- **Pre-existing / out of scope**: Problems not introduced by this PR. Flag them but don't block. File lb issues for significant ones.

Be direct. Point to exact lines. Explain why something is wrong, not just that it is.
