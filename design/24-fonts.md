# Fonts & Web Font Loading

## Purpose

timber.js needs a font loading story that is build-time deterministic, integrates with 103 Early Hints, and works on Cloudflare Workers. The font pipeline should make custom fonts as fast as system fonts — no layout shift, no invisible text, no runtime font service dependencies.

The existing `timber-fonts` plugin stub and `next/font/google` shim provide the foundation. This doc specifies the full design.

---

## Design Values

1. **Build-time determinism.** Font files, subsets, and CSS are resolved at build time. The build manifest knows every font file every route needs. No runtime Google Fonts API calls.
2. **Early Hints integration.** Fonts are hinted at route match time — before middleware, before React. The browser starts fetching fonts ~50-200ms before the first byte of HTML.
3. **Zero layout shift.** `font-display: swap` with size-adjusted fallbacks eliminates CLS from font loading.
4. **Self-hosted by default.** Font files are bundled into the build output. No external CDN dependencies at runtime.
5. **Progressive — not required.** Apps that use system fonts or load fonts manually are unaffected. The font pipeline is opt-in.

---

## API Surface

### Google Fonts

```tsx
// app/layout.tsx
import { Inter, JetBrains_Mono } from '@timber/fonts/google'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
})

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

**Return value:**

```ts
interface FontResult {
  className: string       // Scoped class that applies font-family
  style: { fontFamily: string }  // Inline style with full font stack
  variable?: string       // CSS custom property name (e.g. "--font-sans")
}
```

The call looks like a runtime function but is a **build-time transform**. The `timber-fonts` plugin intercepts these imports and replaces them with static references to downloaded, subsetted font files.

### Local Fonts

```tsx
import localFont from '@timber/fonts/local'

const myFont = localFont({
  src: [
    { path: './fonts/MyFont-Regular.woff2', weight: '400' },
    { path: './fonts/MyFont-Bold.woff2', weight: '700' },
  ],
  display: 'swap',
  variable: '--font-custom',
})
```

Local fonts skip the download step but still go through the build pipeline for manifest registration, `@font-face` generation, and Early Hints integration.

### `next/font` Compatibility

`next/font/google` and `next/font/local` are shimmed to `@timber/fonts/google` and `@timber/fonts/local` via the existing shim resolution in `timber-shims`. Libraries that import `next/font/google` work without modification.

---

## Build Pipeline

### Step 1: Static Analysis

The `timber-fonts` plugin scans for font function calls during the `transform` hook. Each call is statically analyzed to extract:

- Font family name
- Weights and styles requested
- Subsets
- `display` strategy
- `variable` name
- Which module (and therefore which route segments) uses the font

Calls must be statically analyzable — no computed font names or dynamic configs. The plugin errors at build time if it encounters a non-static call.

### Step 2: Font Download & Subsetting (Google Fonts only)

At build time (not dev time), the plugin:

1. Downloads the requested font files from the Google Fonts CSS API
2. Subsets to the requested character sets
3. Converts to `woff2` if not already
4. Writes files to the build output (alongside other static assets)
5. Generates a content hash for the filename (cache-busting)

Downloaded fonts are cached in `node_modules/.cache/timber-fonts/` to avoid re-downloading on every build.

**Dev mode:** In development, the plugin generates `@font-face` rules pointing to the Google Fonts CDN directly. This avoids the download/subset step during `vite dev` while keeping the API surface identical. Font files are only self-hosted in production builds.

### Step 3: `@font-face` Generation

For each font (Google or local), the plugin generates `@font-face` CSS:

```css
@font-face {
  font-family: 'Inter';
  src: url('/_timber/fonts/inter-latin-400-normal-abc123.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, /* ... */;
}
```

This CSS is injected as a virtual module that the build manifest associates with the segments using the font.

### Step 4: Size-Adjusted Fallbacks

The plugin generates fallback `@font-face` declarations with `size-adjust`, `ascent-override`, `descent-override`, and `line-gap-override` to match the custom font's metrics. This eliminates CLS during swap.

```css
@font-face {
  font-family: 'Inter Fallback';
  src: local('Arial');
  size-adjust: 107.64%;
  ascent-override: 90.49%;
  descent-override: 22.48%;
  line-gap-override: 0%;
}
```

The `className` and `style.fontFamily` returned by the font function include both the custom font and the adjusted fallback:

```ts
{
  className: 'timber-font-inter',
  style: { fontFamily: "'Inter', 'Inter Fallback', system-ui, sans-serif" },
  variable: '--font-sans',
}
```

### Step 5: Build Manifest Registration

Font files are registered in the build manifest under each segment that uses them:

```json
{
  "segments": {
    "app/layout": {
      "css": ["/_timber/css/root-abc123.css"],
      "fonts": [
        {
          "href": "/_timber/fonts/inter-latin-400-normal-abc123.woff2",
          "format": "woff2",
          "crossOrigin": "anonymous"
        }
      ],
      "js": ["/_timber/client-abc123.js"]
    }
  }
}
```

At request time, the server reads font entries from the matched segment chain and includes them in:

1. **103 Early Hints** — `Link: <href>; rel=preload; as=font; crossorigin`
2. **HTML `<head>`** — `<link rel="preload" href="..." as="font" crossorigin>` (fallback for platforms without Early Hints support)

---

## CSS Custom Properties

When `variable` is specified, the plugin generates a CSS rule that sets the custom property on the element with the font's `className`:

```css
.timber-font-inter {
  --font-sans: 'Inter', 'Inter Fallback', system-ui, sans-serif;
}
```

This integrates with Tailwind v4's `@theme` declarations:

```css
@theme {
  --font-sans: var(--font-sans, system-ui, sans-serif);
}
```

The Tailwind theme references the CSS variable with a system font fallback. When the font class is applied to `<html>`, the variable cascades to all children.

---

## Plugin Architecture

The `timber-fonts` plugin lives at `packages/timber-app/src/plugins/fonts.ts` and is registered in the plugin array in `index.ts` (currently a stub).

```
packages/timber-app/src/
  plugins/
    fonts.ts                # Main plugin — transform hook, manifest integration
  fonts/
    google.ts               # Google Fonts download, caching, subset logic
    local.ts                # Local font processing
    fallbacks.ts            # Size-adjusted fallback generation
    css.ts                  # @font-face CSS generation
    types.ts                # Shared types
```

### Plugin Hooks

| Hook | Purpose |
|------|---------|
| `resolveId` | Resolve `@timber/fonts/google` and `@timber/fonts/local` to virtual modules |
| `load` | Return generated font loader code for virtual modules |
| `transform` | Scan for font function calls, extract static config |
| `buildStart` | Download/cache Google Fonts (production only) |
| `generateBundle` | Emit font files and `@font-face` CSS into build output |

---

## Next.js Font Compatibility

`next/font/google` and `next/font/local` are resolved by the `timber-shims` plugin directly to the `timber-fonts` virtual modules (`\0@timber/fonts/google` and `\0@timber/fonts/local`). No separate stub files are needed — the same virtual module serves both import paths.

The `timber-fonts` transform hook recognizes both `@timber/fonts/google` and `next/font/google` import specifiers in source code, so migrating apps can use either import path and get the same build-time font processing.

---

## Docs Site Usage

The docs site (`packages/docs-site`) uses this system for Inter and JetBrains Mono:

```tsx
// packages/docs-site/app/layout.tsx
import { Inter, JetBrains_Mono } from '@timber/fonts/google'

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' })
const mono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-mono' })

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

The `globals.css` theme references these variables:

```css
@theme {
  --font-sans: var(--font-sans, system-ui, sans-serif);
  --font-mono: var(--font-mono, ui-monospace, monospace);
}
```

Until the font plugin is implemented, the docs site falls back to system fonts via the CSS fallback chain. No code changes needed when the plugin ships — the same imports and variable references work with both the stub and the real implementation.

---

## What This Doc Does Not Cover

- **Icon fonts.** Use inline SVG or a component library instead.
- **Variable fonts axis configuration.** Future enhancement — the initial implementation handles static weight/style combinations.
- **Font optimization metrics database.** The fallback metrics (size-adjust, ascent-override, etc.) come from a lookup table. Building or sourcing that table is an implementation detail.

---

## Cross-References

- [Rendering Pipeline](02-rendering-pipeline.md) — 103 Early Hints, flush point, resource hinting
- [Build System](18-build-system.md) — Plugin decomposition, build manifest, virtual modules
- [Ecosystem Compatibility](14-ecosystem.md) — `next/font/google` shim, `next/font/local` gap
- [Docs & Marketing Site](22-docs-site.md) — First consumer of the font pipeline (Inter, JetBrains Mono)
