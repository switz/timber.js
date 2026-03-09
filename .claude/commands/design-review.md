Review PR #$ARGUMENTS for alignment with timber.js design documents.

## Design authority

Read the relevant design documents in `design/` before reviewing:

```
01-philosophy.md        — HTTP correctness, flush-after-onShellReady
02-rendering-pipeline.md — AccessGate, single renderToReadableStream
03-data-fetching.md     — no framework data layer, React.cache for dedup
04-authorization.md     — access.ts, deny(), slot degradation
05-search-params.md     — SearchParamCodec, typed search params
06-caching.md           — timber.cache(), no ISR, no implicit fetch patching
07-routing.md           — proxy.ts + per-route middleware.ts, one-arg signatures
08-forms-and-actions.md — createActionClient, CSRF, redirect allow-list
09-typescript.md        — route map codegen, SearchParamCodec, typed Link
10-error-handling.md    — RenderError, status-code file fallback chain, dangerouslyPassData
11-platform.md          — Cloudflare primary, ALS mandatory, adapter model
13-security.md          — security model
16-metadata.md          — metadata API
17-logging.md           — instrumentation.ts, OTEL, trace_id
18-build-system.md      — plugin architecture, virtual modules, no file >500 lines
19-client-navigation.md — segment router, prefetch cache
```

## Workflow

1. `gh pr view $ARGUMENTS` and `gh pr diff $ARGUMENTS`
2. Map changed files to design areas and read relevant docs
3. Audit for design alignment:
   - Philosophy: Does any code return HTTP 200 before outcome is known?
   - Rendering: Single renderToReadableStream? AccessGate correct?
   - Caching: Any implicit fetch patching or ISR?
   - Routing: proxy.ts (global) + middleware.ts (per-route)? One-arg signatures?
   - Authorization: AccessGate inside React tree? deny() context-dependent? Single AccessContext?
   - Streaming: Framework inserting Suspense boundaries? (forbidden)
   - Forms: redirect() accepting absolute URLs? (must not)
   - Error handling: dangerouslyPassData prop name? (not generic "data")
   - Platform: ALS failing hard if unavailable?
   - Build: Any file >500 lines? Plugin returns array?
4. Search for prohibited patterns:
   ```bash
   rg "isr-cache|isrCache|revalidate.*seconds|fallback.*blocking" --type ts
   rg "getServerSideProps|getStaticProps|getStaticPaths|pages-router" --type ts
   rg "globalThis\.fetch|global\.fetch" --type ts
   rg "SlotAccessContext" --type ts
   ```
5. Post review via `gh pr review $ARGUMENTS`

## Blocking vs suggestion

**Blocking**: Violates core invariant (HTTP correctness), uses removed pattern (ISR, pages router), implements feature differently than design doc, breaks planned API.
**Suggestion**: Could be cleaner, missing non-critical feature from design, naming differs but functionally equivalent.
