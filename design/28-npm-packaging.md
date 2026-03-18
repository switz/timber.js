# npm Packaging Strategy

## Current State

`@timber-js/app` has no build step — `package.json` build script is `echo 'TODO: build step'`. All 8 exports point directly to `.ts` source files, the CLI bin entry points to raw TypeScript, and there is no `dist/` output, `publishConfig`, `files` field, or publishing CI. This works for local workspace consumption via pnpm and Vite path aliases, but is not viable for npm distribution.

> **Note on package name:** The `@timber` npm scope is taken. The published package will likely be `@timber-js/app` (or another available scope). This doc uses `@timber-js/app` to match the current workspace name — the rename is a separate concern addressed during the actual publish step.

Current `exports`:

```json
{
  ".": "./src/index.ts",
  "./server": "./src/server/index.ts",
  "./client": "./src/client/index.ts",
  "./cache": "./src/cache/index.ts",
  "./content": "./src/content/index.ts",
  "./cookies": "./src/cookies/index.ts",
  "./search-params": "./src/search-params/index.ts",
  "./routing": "./src/routing/index.ts",
  "./adapters/*": "./src/adapters/*.ts"
}
```

---

## Recommendation: Ship Compiled ESM + Declaration Files

### Decision

Ship compiled `.js` (ESM) + `.d.ts` + `.d.ts.map` in `dist/`. Do NOT ship raw `.ts` source as the primary entry.

### Rationale

**Why not ship raw `.ts` source (the SvelteKit/Vinxi approach)?**

SvelteKit ships raw `.js` source (not TypeScript — JSDoc-annotated JavaScript) with separately generated `.d.ts` files. Vinxi does the same. This works because:

1. Their source is already JavaScript — no compilation needed by consumers
2. They control the tooling chain that consumes the package

timber.js is TypeScript, and shipping `.ts` source would require every consumer's toolchain to compile it. This creates problems:

- **Vite dev mode works** (Vite transpiles `.ts` on the fly), but many tools in the ecosystem don't — Jest, older webpack setups, `tsx`/`ts-node` in scripts, etc.
- **Version skew**: If a consumer's `tsconfig.json` has different `target`, `moduleResolution`, or `strict` settings, compilation may fail or produce different behavior
- **Slower cold starts**: Every `vite dev` invocation must compile the framework source on first load
- **Type-checking burden**: Consumer's `tsc --noEmit` would type-check timber's internals, catching internal implementation issues that are not the consumer's concern

**Why ESM-only (no CJS)?**

- `@timber-js/app` is `"type": "module"` — already ESM
- All peer dependencies (Vite 7, React 19, `@vitejs/plugin-rsc`) are ESM
- The target runtime (Cloudflare Workers) is ESM
- Shipping dual CJS/ESM adds complexity and bundle size for zero benefit
- React Router (`@react-router/dev`) is the only comparable framework still shipping CJS, and only for legacy Node.js compatibility that timber doesn't need

### Industry Survey

| Framework             | Ships                                  | Build Tool             | ESM/CJS |
| --------------------- | -------------------------------------- | ---------------------- | ------- |
| @tanstack/react-start | compiled ESM + d.ts (+ raw src)        | Vite library mode      | ESM     |
| vinxi                 | raw JS source + generated d.ts         | tsc (types only)       | ESM     |
| @react-router/dev     | compiled JS + d.ts                     | tsup                   | CJS     |
| astro                 | compiled JS + d.ts                     | esbuild + tsc          | ESM     |
| @sveltejs/kit         | raw JS source (JSDoc) + generated d.ts | dts-buddy (types only) | ESM     |
| vite                  | compiled JS + d.ts                     | Rolldown + tsc         | ESM     |

Most modern Vite-ecosystem frameworks ship compiled ESM with declaration files.

---

## Build Tooling: Vite Library Mode (Rolldown) + tsc

### Decision

Use **Vite library mode** (backed by Rolldown) for JS bundling, and a separate **tsc** pass (or `tsgo` once it supports emit) for `.d.ts` generation. No new runtime dependencies.

### Rationale

| Tool                  | Pros                                                                                                               | Cons                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Vite library mode** | Already a dependency, Rolldown is fast (Rust-native), Vite dogfoods this for its own build, TanStack Start uses it | No `.d.ts` generation — needs separate tsc pass                                          |
| **tsup**              | Single command for JS+d.ts, multiple entry points                                                                  | New dependency (pulls esbuild + rollup-plugin-dts), redundant with Vite already in stack |
| **unbuild**           | Similar to tsup, auto-infers entries from exports                                                                  | Less adoption, more magic, also a new dep                                                |
| **plain tsc**         | No extra deps, outputs match source structure 1:1                                                                  | No bundling, no tree-shaking, emits every internal file individually                     |
| **esbuild direct**    | Fast                                                                                                               | No `.d.ts` generation, not Rust-native like Rolldown                                     |

**Vite library mode** is the best fit because:

1. **Zero new dependencies** — Vite is already a peer dep and the core of timber's toolchain. Building a Vite plugin with Vite is the natural choice.
2. **Rolldown is proven** — Vite itself recently migrated from Rollup to Rolldown for its own build. If it's good enough for Vite's self-hosting, it's good enough for a Vite plugin.
3. **TanStack Start uses this pattern** — proven for multi-entry Vite-plugin frameworks shipping to npm.
4. **Faster than esbuild** — Rolldown is Rust-native and handles bundling, tree-shaking, and code splitting natively.
5. **Two commands, but no new deps** — the `.d.ts` gap is solved with `tsc --emitDeclarationOnly` (or `tsgo --emitDeclarationOnly` once available). This is the same pattern Vite uses: Rolldown for JS, separate pass for types.

### Configuration Sketch

```ts
// packages/timber-app/vite.lib.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        'index': 'src/index.ts',
        'server/index': 'src/server/index.ts',
        'client/index': 'src/client/index.ts',
        'cache/index': 'src/cache/index.ts',
        'content/index': 'src/content/index.ts',
        'cookies/index': 'src/cookies/index.ts',
        'search-params/index': 'src/search-params/index.ts',
        'routing/index': 'src/routing/index.ts',
        'adapters/cloudflare': 'src/adapters/cloudflare.ts',
        'adapters/nitro': 'src/adapters/nitro.ts',
        'cli': 'src/cli.ts',
      },
      formats: ['es'],
    },
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'vite',
        '@vitejs/plugin-rsc',
        '@vitejs/plugin-react',
        'nuqs',
        'zod',
        /^node:/,
        // All peer + optional deps externalized
      ],
    },
  },
});
```

### Build Script

```json
{
  "scripts": {
    "build": "vite build --config vite.lib.config.ts && tsc --emitDeclarationOnly --outDir dist",
    "typecheck": "tsgo --noEmit"
  }
}
```

---

## Exports Field

### Decision

Use conditional exports with `types` + `import` conditions. The `types` condition MUST come first (TypeScript requires it).

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./server": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.js"
    },
    "./client": {
      "types": "./dist/client/index.d.ts",
      "import": "./dist/client/index.js"
    },
    "./cache": {
      "types": "./dist/cache/index.d.ts",
      "import": "./dist/cache/index.js"
    },
    "./content": {
      "types": "./dist/content/index.d.ts",
      "import": "./dist/content/index.js"
    },
    "./cookies": {
      "types": "./dist/cookies/index.d.ts",
      "import": "./dist/cookies/index.js"
    },
    "./search-params": {
      "types": "./dist/search-params/index.d.ts",
      "import": "./dist/search-params/index.js"
    },
    "./routing": {
      "types": "./dist/routing/index.d.ts",
      "import": "./dist/routing/index.js"
    },
    "./adapters/cloudflare": {
      "types": "./dist/adapters/cloudflare.d.ts",
      "import": "./dist/adapters/cloudflare.js"
    },
    "./adapters/nitro": {
      "types": "./dist/adapters/nitro.d.ts",
      "import": "./dist/adapters/nitro.js"
    },
    "./package.json": "./package.json"
  }
}
```

### Adapters: Named Exports Replace Wildcard

The current `"./adapters/*": "./src/adapters/*.ts"` wildcard must change to explicit entries. Wildcard exports with conditional subpaths are ambiguous and poorly supported by TypeScript's `moduleResolution: "bundler"`. With only two adapters (cloudflare, nitro), explicit entries are clearer and fully type-safe.

### Development: `publishConfig` for Local Workspace

During development, the workspace still needs to resolve to `.ts` source (Vite transpiles on the fly, tests need source). Two options:

**Option A — `publishConfig` override (recommended):**

```json
{
  "exports": {
    ".": "./src/index.ts"
  },
  "publishConfig": {
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "import": "./dist/index.js"
      }
    }
  }
}
```

pnpm applies `publishConfig` fields when packing/publishing, so workspace consumers see `.ts` source while npm consumers see `dist/`. This is the approach TanStack Start uses.

**Option B — Vite path aliases only:**

Keep the path aliases in the root `tsconfig.json` (`@timber-js/app` → `./packages/timber-app/src/index.ts`) and point `exports` directly to `dist/`. The workspace never resolves via `exports` — Vite and tsgo use the path aliases.

Option A is recommended because it's explicit and self-documenting. Option B relies on implicit alias behavior that may break with different toolchains.

---

## CLI Binary

### Decision

The CLI bin entry must point to compiled JavaScript with a shebang.

```json
{
  "bin": {
    "timber": "./dist/cli.js"
  }
}
```

tsup can inject the shebang automatically:

```ts
// tsup.config.ts
{
  entry: { cli: 'src/cli.ts' },
  banner: { js: '#!/usr/bin/env node' },
}
```

Alternatively, use a thin wrapper at `bin/timber.mjs`:

```js
#!/usr/bin/env node
import '../dist/cli.js';
```

The thin wrapper approach (used by Astro, Vite, React Router) is more robust — the bin entry never changes location regardless of build output changes.

---

## `files` Field

### Decision

Explicitly list published files to minimize package size:

```json
{
  "files": ["dist", "bin", "README.md", "LICENSE"]
}
```

This excludes `src/`, `tests/`, `design/`, examples, and config files. A `.npmignore` is NOT needed when `files` is specified — `files` acts as an allowlist.

### Estimated Package Size

The compiled output should be significantly smaller than shipping the full `src/` directory (100+ `.ts` files). tsup's `splitting: true` deduplicates shared code across entry points. Estimate: 200-400 KB total (JS + d.ts + sourcemaps).

---

## Peer Dependencies

### Current State

```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "vite": "^7.0.0"
}
```

### Concerns

**React version:** timber uses stable React 19 APIs (`use`, `useActionState`, server components). All RSC Flight APIs come from `@vitejs/plugin-rsc` which vendors its own `react-server-dom-webpack` internally — the project-level React version is not used for Flight deserialization. The `^19.0.0` peer dependency range accepts any React 19.x stable release.

**Recommendation:** Keep `^19.0.0` peer dependency range. No canary pin is needed.

**Vite 7:** Not yet widely adopted. The `^7.0.0` range is correct — Vite follows semver. Once Vite 7 is stable, this is a non-issue.

**`@vitejs/plugin-rsc`:** Currently a direct dependency (not peer). This is correct — `@timber-js/app` depends on a specific version of the RSC plugin and consumers should not need to install it separately. However, if the RSC plugin's API stabilizes and consumers may want to configure it directly, it could move to a peer dependency in the future.

---

## `@vitejs/plugin-rsc` Stability

### Assessment

`@vitejs/plugin-rsc` is at `^0.5.19` — semver `0.x` signals instability. The package is maintained by the Vite team and is the only viable RSC-on-Vite integration. Risks:

- **Breaking changes in 0.x releases** — any minor bump can break the API
- **Tight coupling** — timber relies on specific plugin hooks, entry configuration, and build pipeline behavior
- **No alternative** — if the plugin changes direction, timber must adapt

### Mitigation

1. **Pin to a narrow range** — use `~0.5.19` (patch only) instead of `^0.5.19` (minor). Update deliberately after testing.
2. **Keep it as a direct dependency** — consumers should not need to know about or install it.
3. **Abstract the integration** — timber already wraps the RSC plugin configuration in `index.ts`. If the plugin API changes, only one file needs updating.
4. **Track upstream** — monitor the `@vitejs/plugin-rsc` changelog and test against pre-releases.

---

## Versioning Strategy

### Decision

Use `0.x` semver with a `canary` dist-tag for pre-release builds.

```
0.1.0        — first npm publish (latest tag)
0.1.1        — patch fix
0.2.0        — breaking API change (new minor in 0.x = breaking)
0.2.1-canary.0  — canary pre-release (canary tag)
```

### Rationale

- `0.x` communicates that the API is not yet stable — expected for a framework depending on Vite 7 and `@vitejs/plugin-rsc` pre-release
- Follow semver strictly: in `0.x`, minor bumps signal breaking changes, patch bumps signal fixes
- `canary` dist-tag for CI-published pre-release builds: `npm install @timber-js/app@canary`
- Move to `1.0.0` only when: Vite 7 is stable, `@vitejs/plugin-rsc` is `>=1.0.0`, and timber's public API surface is settled

### Monorepo Publishing (Out of Scope)

Changesets (`@changesets/cli`) or similar tooling for monorepo version management is a follow-up task. The current workspace has only one publishable package (`@timber-js/app`), so manual versioning suffices initially.

---

## Implementation Plan

These are the concrete steps to implement this strategy (each should be a separate task/PR):

### Step 1: Add Vite library mode build config

- Create `vite.lib.config.ts` with entry points (Vite library mode, Rolldown)
- Add separate `tsc --emitDeclarationOnly` pass for `.d.ts` generation
- Update `build` script to `vite build --config vite.lib.config.ts && tsc --emitDeclarationOnly`
- Create `bin/timber.mjs` thin CLI wrapper with shebang
- Verify `dist/` output matches expected structure
- `dist/` already in `.gitignore`

### Step 2: Update package.json for publishing

- Switch `exports` to conditional `types` + `import` pointing to `dist/`
- Add `publishConfig` with the production exports (keep dev exports pointing to `src/`)
- Add `files` field
- Update `bin` entry
- Pin `@vitejs/plugin-rsc` to `~0.5.x`
- Verify workspace resolution still works (`pnpm test`, `pnpm run typecheck`)

### Step 3: Add publishing CI

- GitHub Actions workflow: build → test → publish on tag
- `canary` dist-tag for main branch builds
- `latest` dist-tag for version tags
- npm provenance (SLSA) for supply chain security

### Step 4: Documentation

- Add installation instructions to README
- Document peer dependency requirements
- Document React 19 stable peer dependency requirement

---

## Open Questions

1. **Source maps in published package?** Including `sourcemap: true` adds ~30% to package size but enables debugging into timber internals. **Decision: yes**, source maps are included in the Vite library mode build.

2. **`typesVersions` fallback?** Older TypeScript versions (< 4.7) don't support `exports` conditions. A `typesVersions` field can provide fallback resolution. Worth adding if adoption data shows consumers on older TS versions.

3. **Should examples be a separate package?** Currently in the same repo. If examples grow, they could be published as `create-timber-app` or similar. Out of scope for now.

4. **Prepublish validation?** **Decision: yes**, `prepublishOnly` runs `pnpm run build` which executes both the Vite library mode build and tsc declaration pass.
