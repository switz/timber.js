Pull the latest commits from upstream vinext and triage them against timber.js design docs.

## Design authority

Read the relevant design documents in `design/` before triaging. Key docs:
- `01-philosophy.md` — flush after `onShellReady`, no HTTP 200 lies
- `06-caching.md` — `timber.cache()`, no ISR, no implicit fetch patching
- `07-routing.md` — `proxy.ts` + per-route `middleware.ts`, one-arg signatures
- `11-platform.md` — Cloudflare primary, ALS mandatory
- `13-security.md` — security model and test checklist
- `18-build-system.md` — plugin architecture, virtual modules

## Setup

Ensure the vinext upstream remote is configured:
```bash
git remote get-url vinext 2>/dev/null || git remote add vinext https://github.com/nickvdp/vinext.git
```

## Workflow

### Step 1: Fetch upstream
```bash
git fetch vinext main
git log main..vinext/main --oneline
```

### Step 2: Triage each commit

For each new upstream commit, `git show <sha>` and classify:

- **APPLICABLE** — Infrastructure timber shares (Vite plugin core, RSC protocol, shims, security fixes, build tooling, @vitejs/plugin-rsc integration)
- **DIVERGES** — Features timber removed (pages router, ISR, global middleware.ts, isr-cache, tpr)
- **ALREADY-DONE** — Equivalent change already in timber.js
- **NOT-APPLICABLE** — Irrelevant (vinext examples, CLI specific to vinext, removed feature tests)

### Step 3: File bd issues for APPLICABLE commits
```bash
bd create "upstream: <description>" \
  --description="Upstream vinext commit <sha>. <summary>. <why it applies>. <porting notes>" \
  -t task -p 2 --json
```

### Step 4: Print report

```
## Upstream triage — <date>
Range: <old-sha>..<new-sha>
### Applicable (<count>) — <sha> <subject> → bd issue <id>
### Diverges (<count>) — <sha> <subject> — <reason>
### Already done (<count>)
### Not applicable (<count>)
```

## Triage heuristics

**Always applicable:** RSC streaming, HMR, Vite plugin internals, security fixes, shim improvements, `@vitejs/plugin-rsc` updates
**Never applicable:** `server/dev-server.ts` (pages router), `server/api-handler.ts`, `routing/pages-router.ts`, `isr-cache.ts`, `tpr.ts`, global `middleware.ts`
**Apply only App Router half:** commits touching both `app-dev-server.ts` and `dev-server.ts`
**Security:** Always applicable — even if the vulnerable path doesn't exist in timber, check for the same vulnerability class in timber's code.
