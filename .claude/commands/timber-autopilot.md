Run the full timber.js task-to-merge autopilot for lb task $ARGUMENTS (or the next ready task if no argument given).

## Phase 0: Select and claim a task

If $ARGUMENTS is empty, run `lb ready --json` and pick the highest-priority unowned task. If $ARGUMENTS is set, use that task ID directly. Claim it with `lb update <id> --status in_progress --json`. If you decide to work on a task yourself, claim it so no other streams grab it.

If there are multiple tasks that fit well together, you can do several at one time if they are unified and not too wide in scope. Don't select too many though.

If an issue is already claimed, there is work being done on it in parallel. Pick another task.

## Phase 1: Read design docs

Before touching any code, read the relevant design documents. The task will tell you what area it touches — read that design doc in full before writing a single line of code. Ask questions we need to solve before implementation.

All design documents are in `design/`. Key references:

- `01-philosophy.md` — timber's core HTTP correctness guarantee, no pages router, no ISR
- `02-rendering-pipeline.md` — flush point, AccessGate, rendering lifecycle
- `06-caching.md` — `timber.cache()`, no ISR, no implicit fetch patching
- `07-routing.md` — `proxy.ts` + per-route `middleware.ts`, segment tree diffing
- `13-security.md` — security taxonomy and test checklist (always read this)
- `18-build-system.md` — plugin architecture, virtual modules, entry generation
- `19-client-navigation.md` — segment router, prefetch cache, scroll restoration

Ask questions in claude mode if we need to clarify anything.

## Phase 2: Implement

1. Generate a short slug from the task title (lowercase, hyphens, max 30 chars)
2. Create a feature branch: `git checkout -b <id>-<slug>`
3. Write tests first, then implement
4. Run checks: `pnpm test tests/<relevant>.test.ts && pnpm run typecheck && pnpm run lint`
5. Update design documents for anything we learned or decided on during implementation to keep them consistent and up to date.
6. Commit and push: `git push -u origin <id>-<slug>`
7. Create PR with `gh pr create --base main`

## Phase 3: Self-review

Before requesting external review:

1. Re-read the diff against the design docs
2. Check security against `design/13-security.md`
3. Run lint and typecheck and fix issues
4. Verify no file exceeds 500 lines
5. Pull all Github PR comments/reviews from codex and other reviewers and double verify them

## Phase 4: Address feedback and merge

1. Read all review comments
2. Fix blocking issues, file lb issues for out-of-scope findings with `--discovered-from <task-id>`
3. Enable auto-merge: `gh pr merge <PR_NUMBER> --auto --squash --delete-branch`
4. Close the lb task: `lb close <id> --reason "Implemented in PR #<PR_NUMBER>"`
5. After merge, switch back to `main` and pull latest
6. If everything looks good and passes, clear context and run a new autopilot

## Rules

- **One task at a time.** Do not start a second task until the first is merged and closed.
- **Design docs are authoritative.** If the lb task conflicts with a design doc, the design doc wins.
- **Ask questions for clarification.** Always ask questions if there is confusing or conflicting ideas. We want to get it correct.
- **Never push to main directly.** Always use a feature branch and open a PR.
- **Never use `gh pr merge --admin`.** If merge is blocked, investigate why.
- **Security check is mandatory.** Read `design/13-security.md` before every implementation.
- **No file >500 lines.** Decompose if approaching the limit. Comments and blank lines don't count toward the limit — never trim comments to reduce line count.
- **Maintain Context Through Plan** If running this in a plan, make sure to pass through all of these instructions through the plan.
