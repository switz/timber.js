Well-Spec'd Docs (implementation-ready)

  02-rendering-pipeline.md — Excellent. 432 lines. Covers the flush point, element tree construction,
  AccessGate pattern, cache scoping, data waterfall elimination. Has concrete examples, ASCII diagrams, and
   clear behavioral contracts. The LayoutShell lesson is embedded here now (§"Layout State Preservation"
  explicitly says "no wrapper needed").

  05-streaming.md — Very good. DeferredSuspense has a complete implementation in the doc (actual React
  code). Status code contract is clear. Edge cases documented (deny() inside Suspense, timing
  dependencies).

  06-caching.md — Good API spec. Clear interface definitions, behavioral tables, invalidation modes. But
  see problems below.

  07-routing.md — Comprehensive. 686 lines covering proxy.ts, middleware.ts, Link, navigation, segment tree
   diffing, route.ts, i18n. Thorough.

  04-authorization.md — Good. AccessGate, slot access, deny/redirect semantics all well-specified.

  Underspec'd Docs (caused or will cause implementation problems)

  1. 03-data-fetching.md — Dangerously thin (54 lines)

  This is the shortest design doc and arguably the most important runtime concern. It says "components own
  their data" and "use React.cache" and that's basically it. What's missing:
  - How does timber.cache integrate with the render pass? The caching doc (06) has the API but not the
  runtime wiring.
  - What happens when a timber.cache call is made outside a request context (e.g., during module
  initialization)?
  - Error handling for failed fetches — does a thrown error in a data function propagate as a render error?
   Always?
  - No guidance on where data functions should live (co-located with routes? In a lib/ directory?). This is
   an agent handoff problem — agents will make inconsistent choices.

  2. 06-caching.md — Good API, missing implementation architecture

  The API surface (timber.cache, "use cache", CacheHandler) is well-defined. What's missing:
  - How "use cache" transforms work at the Vite plugin level. The doc says what it does but not how the
  build transform works. This is exactly what caused the cache-runtime.ts mess — the agent had to figure
  out the transform implementation with no guidance.
  - Design influences and decisions. The doc didn't originally explain which concepts from the broader
  RSC caching design space were adopted vs. rejected. This was addressed in the "Design Influences" section.
  - Where the runtime code lives. No file manifest. The agent put everything in one cache-runtime.ts file
  because there was no guidance on decomposition.

  3. 11-platform.md — Missing Vite plugin architecture

  This doc covers timber.config.ts, adapters, CLI commands, and env vars. What's completely missing:
  - How the Vite plugin is structured. This is the #1 architectural decision and there's zero spec for it.
  No mention of sub-plugins, no file decomposition guidance, no module responsibility boundaries. This is
  why index.ts became a 2,301-line god object.
  - Virtual module strategy. How virtual modules are generated, the resolution quirks (root prefix, \0
  prefix), the three-environment model. This is documented only in CLAUDE.md as "gotchas" discovered
  through debugging.
  - Entry generation approach. Whether entries are codegen'd as strings or real modules. This is the
  biggest architectural choice and it's unspec'd.

  4. 08-forms-and-actions.md — Missing client-side mechanics

  Good spec for the action builder API (createActionClient, ActionError, schema validation). Missing:
  - How the form submission is intercepted client-side. The doc says "with JS loaded, form submission is
  intercepted" but doesn't spec the mechanism.
  - How revalidatePath RSC payload piggybacks on the action response. The doc says "the RSC payload
  piggybacks on the existing action response channel" — one sentence for a complex implementation detail.
  - Progressive enhancement testing strategy. How to verify forms work without JS.

  5. No doc for the Vite plugin / build system

  This is the biggest gap. There is no design doc for:
  - How index.ts should be structured (sub-plugins vs monolith)
  - How entry generation works (codegen vs real modules)
  - How the three-environment model (RSC/SSR/browser) is wired
  - How virtual modules are resolved and the known quirks
  - How shim mapping works (next/* → timber shims)
  - How the build pipeline sequences (createBuilder → buildApp → 5-step process)

  This is arguably the most complex part of the framework and it has zero spec. Every architectural problem
   (god object plugin, monolithic server, stringly-typed codegen) traces back to this gap.

  6. No doc for client-side navigation runtime

  07-routing.md specs the behavior (segment tree diffing, prefetch cache, scroll restoration) but not the
  implementation:
  - What client-side modules exist?
  - How does the segment router work?
  - How are RSC payloads fetched, cached, and replayed?
  - How does the client compose partial payloads with cached segments?

  This is Phase 2's domain and the spec gap will cause the same problems we saw in Phase 1.

  Summary

  ┌───────────────────────┬────────────────────┬───────────────────────────────────────────────────────┐
  │          Doc          │    Spec Quality    │                          Gap                          │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 01-philosophy         │ Good (values)      │ N/A — it's philosophy, not spec                       │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 02-rendering-pipeline │ Excellent          │ None                                                  │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 03-data-fetching      │ Too thin           │ Missing runtime integration, error handling, code     │
  │                       │                    │ organization                                          │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 04-authorization      │ Good               │ None                                                  │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 05-streaming          │ Good               │ None                                                  │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 06-caching            │ API good, impl     │ No transform architecture, no file decomposition, no  │
  │                       │ missing            │ design influence guidance                             │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 07-routing            │ Good (behavior)    │ No client runtime spec                                │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 08-forms-and-actions  │ Partial            │ Missing client interception, RSC piggyback mechanism  │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 09-typescript         │ Good               │ None                                                  │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 10-error-handling     │ Good               │ None                                                  │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 11-platform           │ Major gap          │ No Vite plugin architecture spec at all               │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 12-example            │ Good (walkthrough) │ N/A                                                   │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ 13-security           │ Good               │ None                                                  │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ (missing)             │ Critical gap       │ No build system / Vite plugin design doc              │
  ├───────────────────────┼────────────────────┼───────────────────────────────────────────────────────┤
  │ (missing)             │ Critical gap       │ No client navigation runtime design doc               │
  └───────────────────────┴────────────────────┴───────────────────────────────────────────────────────┘

  The Pattern

  The docs are strongest on user-facing API surfaces (what developers write) and weakest on framework
  internals (how the framework implements those APIs). This makes sense — the docs were written from the
  user's perspective. But agents implementing the framework need the internal architecture spec'd too, and
  that's exactly what was missing.

  ---

  UPDATE: All gaps above have been addressed:

  - 03-data-fetching.md — Expanded with runtime integration, error handling, code organization, and
    waterfall/prefetching guidance.
  - 06-caching.md — Added implementation architecture section: file decomposition, "use cache" transform,
    cache key generation, singleflight implementation, design influence guidance.
  - 08-forms-and-actions.md — Added client mechanics section: form submission interception, RSC payload
    piggyback, no-JS action flow, action response encoding.
  - 11-platform.md — Added Vite plugin architecture section: plugin decomposition, virtual module strategy,
    entry generation, three-environment model.
  - 18-build-system.md — NEW. Full build system design doc covering plugin architecture, module resolution,
    virtual modules, entry generation, build pipeline, dev server HMR, file budgets.
  - 19-client-navigation.md — NEW. Full client navigation design doc covering segment router, RSC payload
    handling, history stack, prefetch cache, scroll restoration, useNavigationPending().

  Additional fixes applied across all docs:
  - Middleware signature updated from 3-arg (req, res, ctx) to 1-arg (ctx: MiddlewareContext)
  - Route handler signature updated from 2-arg (req, ctx) to 1-arg (ctx: RouteContext)
  - SlotAccessContext removed — single AccessContext type for both segments and slots
  - dangerouslyPassData prop added to 4xx files and denied.tsx for RSC→client data passing
  - PLAN.md updated with all resolved decisions