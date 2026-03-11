# bd Task Template

When creating bd tasks, follow this structure. Example from timber-g18.4:

```bash
bd create "Short descriptive title" \
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
  -p 2 \
  --acceptance "$(cat <<'ENDAC'
- [ ] Requirement → test: tests/file.test.ts "test name"
- [ ] Requirement → test: tests/file.test.ts "test name"
ENDAC
)" \
  --deps "discovered-from:parent-id"
```

## Key rules:
- **Context**: Explain the current state, the gap, and cite design docs
- **Approach Constraints**: DO/DO NOT lists with specific technical guidance
- **Files**: MODIFY/CREATE/READ-ONLY with parenthetical explanation
- **Acceptance**: Each criterion links to a specific test name
- **Deps**: Use `discovered-from:ID` for follow-up tasks, `blocks:ID` for blockers
- Priority: P0 (critical), P1 (high), P2 (normal), P3 (low)
