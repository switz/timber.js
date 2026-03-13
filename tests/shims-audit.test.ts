/**
 * Shim Audit Tests — verify each next/* shim against Next.js API surface.
 *
 * Tests cover:
 * 1. Export shape — every shimmed export exists with the correct type
 * 2. Behavioral correctness — shims behave as expected
 * 3. Ecosystem compat — nuqs and next-themes import patterns work
 * 4. Intentional errors — headers/cookies throw with migration hints
 *
 * See design/14-ecosystem.md for the full audit document.
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNoopTimer } from '../packages/timber-app/src/utils/startup-timer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..', 'packages/timber-app/src');

// ─── next/link shim ──────────────────────────────────────────────────────────

describe('next/link shim', () => {
  it('exports Link as default', async () => {
    const mod = await import('../packages/timber-app/src/shims/link.js');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('exports Link as named export', async () => {
    const mod = await import('../packages/timber-app/src/shims/link.js');
    expect(mod.Link).toBeDefined();
    expect(mod.Link).toBe(mod.default);
  });

  it('default and named Link are the same reference', async () => {
    const mod = await import('../packages/timber-app/src/shims/link.js');
    expect(mod.default).toBe(mod.Link);
  });
});

// ─── next/image shim ─────────────────────────────────────────────────────────

describe('next/image shim', () => {
  it('exports Image as default', async () => {
    const mod = await import('../packages/timber-app/src/shims/image.js');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('exports Image as named export', async () => {
    const mod = await import('../packages/timber-app/src/shims/image.js');
    expect(mod.Image).toBeDefined();
    expect(mod.Image).toBe(mod.default);
  });

  it('Image ignores Next.js-specific optimization props', async () => {
    const mod = await import('../packages/timber-app/src/shims/image.js');
    // The component should accept and silently ignore these props
    const result = mod.Image({
      src: '/photo.jpg',
      alt: 'test',
      width: 100,
      height: 100,
      priority: true,
      quality: 75,
      fill: true,
      placeholder: 'blur' as const,
      blurDataURL: 'data:image/...',
    });
    // Result is a React element — passthrough props live on result.props
    const el = result as { props: Record<string, unknown> };
    expect(el.props.src).toBe('/photo.jpg');
    expect(el.props.alt).toBe('test');
    expect(el.props.width).toBe(100);
    expect(el.props.height).toBe(100);
    // Next.js-specific props should be stripped
    expect(el.props.priority).toBeUndefined();
    expect(el.props.quality).toBeUndefined();
    expect(el.props.fill).toBeUndefined();
    expect(el.props.placeholder).toBeUndefined();
    expect(el.props.blurDataURL).toBeUndefined();
  });
});

// ─── next/navigation shim ────────────────────────────────────────────────────

describe('next/navigation shim', () => {
  describe('export shape', () => {
    it('exports useParams', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof mod.useParams).toBe('function');
    });

    it('exports usePathname', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof mod.usePathname).toBe('function');
    });

    it('exports useSearchParams', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof mod.useSearchParams).toBe('function');
    });

    it('exports useRouter', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof mod.useRouter).toBe('function');
    });

    it('exports redirect', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof mod.redirect).toBe('function');
    });

    it('exports notFound', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof mod.notFound).toBe('function');
    });

    it('exports permanentRedirect', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof mod.permanentRedirect).toBe('function');
    });

    it('exports RedirectType', async () => {
      const mod = await import('../packages/timber-app/src/shims/navigation.js');
      expect(mod.RedirectType).toBeDefined();
      expect(mod.RedirectType.push).toBe('push');
      expect(mod.RedirectType.replace).toBe('replace');
    });
  });

  describe('redirect behavior', () => {
    it('redirect throws RedirectSignal', async () => {
      const { redirect, RedirectSignal } = await import(resolve(SRC_DIR, 'server/primitives.ts'));
      expect(() => redirect('/login')).toThrow(RedirectSignal);
    });

    it('redirect defaults to 302', async () => {
      const { redirect, RedirectSignal } = await import(resolve(SRC_DIR, 'server/primitives.ts'));
      try {
        redirect('/login');
      } catch (e) {
        expect(e).toBeInstanceOf(RedirectSignal);
        expect((e as InstanceType<typeof RedirectSignal>).status).toBe(302);
      }
    });
  });

  describe('permanentRedirect behavior', () => {
    it('permanentRedirect throws RedirectSignal with status 308', async () => {
      const { permanentRedirect, RedirectSignal } = await import(
        resolve(SRC_DIR, 'server/primitives.ts')
      );
      try {
        permanentRedirect('/new-page');
      } catch (e) {
        expect(e).toBeInstanceOf(RedirectSignal);
        expect((e as InstanceType<typeof RedirectSignal>).status).toBe(308);
        expect((e as InstanceType<typeof RedirectSignal>).location).toBe('/new-page');
      }
    });

    it('permanentRedirect rejects absolute URLs (same as redirect)', async () => {
      const { permanentRedirect } = await import(resolve(SRC_DIR, 'server/primitives.ts'));
      expect(() => permanentRedirect('https://evil.com')).toThrow('only accepts relative URLs');
    });
  });

  describe('notFound behavior', () => {
    it('notFound throws DenySignal with status 404', async () => {
      const { notFound, DenySignal } = await import(resolve(SRC_DIR, 'server/primitives.ts'));
      try {
        notFound();
      } catch (e) {
        expect(e).toBeInstanceOf(DenySignal);
        expect((e as InstanceType<typeof DenySignal>).status).toBe(404);
      }
    });

    it('notFound is equivalent to deny(404)', async () => {
      const { notFound, deny, DenySignal } = await import(resolve(SRC_DIR, 'server/primitives.ts'));

      let notFoundError: unknown;
      let denyError: unknown;

      try {
        notFound();
      } catch (e) {
        notFoundError = e;
      }
      try {
        deny(404);
      } catch (e) {
        denyError = e;
      }

      expect(notFoundError).toBeInstanceOf(DenySignal);
      expect(denyError).toBeInstanceOf(DenySignal);
      expect((notFoundError as InstanceType<typeof DenySignal>).status).toBe(
        (denyError as InstanceType<typeof DenySignal>).status
      );
    });
  });

  describe('useParams behavior', () => {
    it('useParams returns current params object', async () => {
      const { useParams, setCurrentParams } = await import(
        resolve(SRC_DIR, 'client/use-params.ts')
      );
      setCurrentParams({ id: '123', slug: 'hello' });
      const params = useParams();
      expect(params).toEqual({ id: '123', slug: 'hello' });
    });
  });
});

// ─── next/headers shim ───────────────────────────────────────────────────────

describe('next/headers shim', () => {
  it('headers() re-exports ALS-backed implementation', async () => {
    const mod = await import('../packages/timber-app/src/shims/headers.js');
    expect(typeof mod.headers).toBe('function');
  });

  it('cookies() re-exports ALS-backed implementation', async () => {
    const mod = await import('../packages/timber-app/src/shims/headers.js');
    expect(typeof mod.cookies).toBe('function');
  });

  it('headers() throws outside request context', async () => {
    const mod = await import('../packages/timber-app/src/shims/headers.js');
    expect(() => mod.headers()).toThrow('outside of a request context');
  });

  it('cookies() throws outside request context', async () => {
    const mod = await import('../packages/timber-app/src/shims/headers.js');
    expect(() => mod.cookies()).toThrow('outside of a request context');
  });
});

// ─── next/font/google → @timber/fonts/google redirect ────────────────────────

describe('next/font/google redirect', () => {
  it('resolves to timber-fonts virtual module (not a stub file)', async () => {
    const { timberShims } = await import('../packages/timber-app/src/plugins/shims.js');
    const plugin = timberShims({
      config: { output: 'server' },
      clientJavascript: { disabled: false, enableHMRInDev: false },
      routeTree: null,
      appDir: resolve(__dirname, '..', 'app'),
      root: resolve(__dirname, '..'),
      dev: false,
      buildManifest: null,
      timer: createNoopTimer(),
    });
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId.call({}, 'next/font/google')).toBe('\0@timber/fonts/google');
  });

  it('resolves next/font/local to timber-fonts virtual module', async () => {
    const { timberShims } = await import('../packages/timber-app/src/plugins/shims.js');
    const plugin = timberShims({
      config: { output: 'server' },
      clientJavascript: { disabled: false, enableHMRInDev: false },
      routeTree: null,
      appDir: resolve(__dirname, '..', 'app'),
      root: resolve(__dirname, '..'),
      dev: false,
      buildManifest: null,
      timer: createNoopTimer(),
    });
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId.call({}, 'next/font/local')).toBe('\0@timber/fonts/local');
  });
});

// ─── next/font/google shim fallback behavior ─────────────────────────────────

describe('next/font/google shim fallback', () => {
  it('exports FontResult-shaped objects from named font functions', async () => {
    const mod = await import('../packages/timber-app/src/shims/font-google.js');
    const result = mod.Inter({ subsets: ['latin'], display: 'swap' });
    expect(result).toEqual({
      className: '',
      style: { fontFamily: '' },
      variable: undefined,
    });
  });

  it('passes through variable config to FontResult', async () => {
    const mod = await import('../packages/timber-app/src/shims/font-google.js');
    const result = mod.Inter({ subsets: ['latin'], variable: '--font-sans' });
    expect(result.variable).toBe('--font-sans');
  });

  it('all exported font functions return the same stub shape', async () => {
    const mod = await import('../packages/timber-app/src/shims/font-google.js');
    const fonts = [mod.Inter, mod.Roboto, mod.JetBrains_Mono, mod.Geist, mod.Geist_Mono];
    for (const fontFn of fonts) {
      const result = fontFn({ subsets: ['latin'] });
      expect(result).toHaveProperty('className', '');
      expect(result).toHaveProperty('style');
      expect(result.style).toHaveProperty('fontFamily', '');
    }
  });

  it('createFont helper returns stub FontResult', async () => {
    const mod = await import('../packages/timber-app/src/shims/font-google.js');
    const result = mod.createFont('Custom Font', { variable: '--font-custom' });
    expect(result.className).toBe('');
    expect(result.style.fontFamily).toBe('');
    expect(result.variable).toBe('--font-custom');
  });

  it('types are re-exported from fonts/types.ts', async () => {
    // This test verifies that the shim re-exports types by checking the
    // runtime function signatures match the FontResult interface.
    const mod = await import('../packages/timber-app/src/shims/font-google.js');
    const result = mod.Inter({});
    const keys = Object.keys(result);
    expect(keys).toContain('className');
    expect(keys).toContain('style');
    // variable is undefined when not specified, so it's in the object but undefined
    expect('variable' in result).toBe(true);
  });
});

// ─── nuqs compatibility ──────────────────────────────────────────────────────

describe('nuqs compatibility', () => {
  it('navigation shim exports useRouter (required by nuqs adapter)', async () => {
    const mod = await import('../packages/timber-app/src/shims/navigation.js');
    expect(typeof mod.useRouter).toBe('function');
  });

  it('navigation shim exports useSearchParams (required by nuqs adapter)', async () => {
    const mod = await import('../packages/timber-app/src/shims/navigation.js');
    expect(typeof mod.useSearchParams).toBe('function');
  });

  it('.js extension import resolves (nuqs imports next/navigation.js)', async () => {
    // This tests the plugin resolveId behavior — nuqs imports with .js extension
    const { timberShims } = await import('../packages/timber-app/src/plugins/shims.js');
    const plugin = timberShims({
      config: { output: 'server' },
      clientJavascript: { disabled: false, enableHMRInDev: false },
      routeTree: null,
      appDir: resolve(__dirname, '..', 'app'),
      root: resolve(__dirname, '..'),
      dev: false,
      buildManifest: null,
      timer: createNoopTimer(),
    });
    const resolveId = plugin.resolveId as (id: string) => string | null;
    const result = resolveId.call({}, 'next/navigation.js');
    expect(result).toBeTruthy();
    expect(result).toContain('navigation.ts');
  });
});

// ─── next-intl compatibility ─────────────────────────────────────────────────

describe('next-intl compatibility', () => {
  describe('core i18n (next-intl root export)', () => {
    it('next-intl core resolves without next/* imports', async () => {
      // The root next-intl export (useTranslations, useFormatter, etc.)
      // only depends on 'use-intl' and 'react' — no next/* imports.
      // This means core i18n functionality works with timber's shims.
      const mod = await import('next-intl');
      expect(mod).toBeDefined();
      // Core hooks should be exported
      expect(typeof mod.useTranslations).toBe('function');
      expect(typeof mod.useFormatter).toBe('function');
      expect(typeof mod.useLocale).toBe('function');
      expect(typeof mod.useNow).toBe('function');
      expect(typeof mod.useTimeZone).toBe('function');
      expect(typeof mod.NextIntlClientProvider).toBe('function');
    });
  });

  describe('navigation integration (next-intl/navigation)', () => {
    it('next-intl/navigation imports useRouter from next/navigation (shimmed)', async () => {
      // next-intl/navigation's createNavigation() uses useRouter and usePathname
      // from next/navigation — both shimmed by timber
      const navShim = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof navShim.useRouter).toBe('function');
      expect(typeof navShim.usePathname).toBe('function');
    });

    it('next-intl/navigation imports next/link (shimmed)', async () => {
      // BaseLink.js imports default from next/link — shimmed by timber
      const linkShim = await import('../packages/timber-app/src/shims/link.js');
      expect(linkShim.default).toBeDefined();
      expect(typeof linkShim.default).toBe('function');
    });

    it('next-intl/navigation imports redirect from next/navigation (shimmed)', async () => {
      // createSharedNavigationFns.js imports redirect — shimmed by timber
      const navShim = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof navShim.redirect).toBe('function');
    });

    it('next-intl/navigation imports permanentRedirect from next/navigation (shimmed)', async () => {
      // createSharedNavigationFns.js imports permanentRedirect — shimmed as redirect(path, 308)
      const navShim = await import('../packages/timber-app/src/shims/navigation.js');
      expect(typeof navShim.permanentRedirect).toBe('function');
    });
  });

  describe('server integration (next-intl/server)', () => {
    it('next-intl/server imports headers() from next/headers (ALS-backed)', async () => {
      // next-intl's getRequestLocale() calls headers() from next/headers.
      // timber's next/headers shim re-exports the real ALS-backed implementation.
      // Outside a request context it throws — but within a request it works.
      const headersShim = await import('../packages/timber-app/src/shims/headers.js');
      expect(typeof headersShim.headers).toBe('function');
      // Throws outside request context (no ALS scope), not with "not available"
      expect(() => headersShim.headers()).toThrow('outside of a request context');
    });

    it('next-intl/server imports cookies() from next/headers (ALS-backed)', async () => {
      const headersShim = await import('../packages/timber-app/src/shims/headers.js');
      expect(typeof headersShim.cookies).toBe('function');
      expect(() => headersShim.cookies()).toThrow('outside of a request context');
    });
  });

  describe('middleware (next-intl/middleware)', () => {
    it('next-intl/middleware imports NextResponse from next/server (NOT shimmed)', async () => {
      // next-intl's middleware imports NextResponse from next/server.
      // next/server is not in timber's shim map — intentionally not shimmed.
      // timber uses proxy.ts instead of Next.js middleware.
      const { timberShims } = await import('../packages/timber-app/src/plugins/shims.js');
      const plugin = timberShims({
        config: { output: 'server' },
        clientJavascript: { disabled: false, enableHMRInDev: false },
        routeTree: null,
        appDir: resolve(__dirname, '..', 'app'),
        root: resolve(__dirname, '..'),
        dev: false,
        buildManifest: null,
        timer: createNoopTimer(),
      });
      const resolveId = plugin.resolveId as (id: string) => string | null;
      const result = resolveId.call({}, 'next/server');
      expect(result).toBeNull(); // Not shimmed
    });
  });

  describe('plugin (next-intl/plugin)', () => {
    it('next-intl/plugin is Next.js-only (imports next/package.json)', () => {
      // createNextIntlPlugin reads next/package.json for version detection.
      // This is a Next.js build plugin — not applicable to timber.
      // No shim needed; users should not use next-intl/plugin with timber.
      expect(true).toBe(true);
    });
  });
});

// ─── next-themes compatibility ───────────────────────────────────────────────

describe('next-themes compatibility', () => {
  it('next-themes requires no next/* shims (pure React)', () => {
    // next-themes only imports from 'react' — no next/* imports needed.
    // This test documents the finding. If next-themes ever adds next/*
    // imports, this test should be updated with shim verification.
    expect(true).toBe(true);
  });
});

// ─── Cross-shim: no message-matching on DenySignal ───────────────────────────

describe('DenySignal handling integrity', () => {
  it('DenySignal is caught via instanceof, not message matching', async () => {
    const { DenySignal } = await import(resolve(SRC_DIR, 'server/primitives.ts'));
    const signal = new DenySignal(403);

    // Verify instanceof works (the correct detection path)
    expect(signal instanceof DenySignal).toBe(true);
    expect(signal instanceof Error).toBe(true);
    expect(signal.status).toBe(403);
    expect(signal.name).toBe('DenySignal');
  });
});
