Monitor recent commits from Vinext (Cloudflare's RSC-on-Vite framework) and triage them against timber.js design docs. timber.js is an independent implementation, but we monitor Vinext for bug fixes and security patches that may apply to the same problem space.

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

- **APPLICABLE** — Addresses a bug class or pattern that timber.js's independent codebase may also have (Vite plugin patterns, RSC protocol, shims, security fixes, build tooling)
- **DIVERGES** — Features timber.js doesn't have (pages router, ISR, global middleware.ts, isr-cache, tpr)
- **ALREADY-DONE** — Equivalent fix or feature already in timber.js
- **NOT-APPLICABLE** — Irrelevant (vinext-specific examples, CLI, infrastructure)

### Step 3: File lb issues for APPLICABLE commits
```bash
lb create "upstream: <description>" \
  -d "Upstream Vinext commit <sha>. <summary>. <why it applies to timber.js>. <implementation notes>" \
  -p 2 --json
```

### Step 4: Print report

```
## Upstream triage — <date>
Range: <old-sha>..<new-sha>
### Applicable (<count>) — <sha> <subject> → lb issue <id>
### Diverges (<count>) — <sha> <subject> — <reason>
### Already done (<count>)
### Not applicable (<count>)
```

## Triage heuristics

**Always applicable:** RSC streaming, HMR, Vite plugin internals, security fixes, shim improvements, `@vitejs/plugin-rsc` updates
**Never applicable:** `server/dev-server.ts` (pages router), `server/api-handler.ts`, `routing/pages-router.ts`, `isr-cache.ts`, `tpr.ts`, global `middleware.ts`
**Apply only App Router half:** commits touching both `app-dev-server.ts` and `dev-server.ts`
**Security:** Always applicable — even if the vulnerable path doesn't exist in timber, check for the same vulnerability class in timber's code.
