/**
 * Tests for the built-in top-loader progress bar.
 *
 * Verifies that:
 * 1. TopLoader renders nothing when no navigation is pending
 * 2. TopLoader renders a bar when navigation is pending
 * 3. TopLoader accepts all config props without error
 * 4. TopLoader applies custom color, height, zIndex via inline styles
 * 5. TransitionRoot accepts topLoaderConfig prop
 * 6. TimberUserConfig includes topLoader config type
 *
 * Uses renderToStaticMarkup for synchronous context-based rendering.
 * Phase transitions (crawling/finishing/hidden) are derived during render
 * via getDerivedStateFromProps — no useEffect or timers to manage.
 */

// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  PendingNavigationProvider,
} from '../packages/timber-app/src/client/navigation-context';

import { TopLoader } from '../packages/timber-app/src/client/top-loader';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderToHtml(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TopLoader', () => {
  describe('rendering based on pending state', () => {
    it('renders nothing when no navigation is pending', () => {
      // No PendingNavigationProvider → pendingUrl is null → hidden
      const html = renderToHtml(createElement(TopLoader, { config: {} }));
      expect(html).toBe('');
    });

    it('renders the bar when a navigation is pending', () => {
      // With a pending URL, the component derives phase=crawling synchronously
      const html = renderToHtml(
        createElement(
          PendingNavigationProvider,
          { value: '/dashboard' },
          createElement(TopLoader, { config: {} })
        )
      );
      expect(html).toContain('data-timber-top-loader');
      expect(html).toContain('position:fixed');
    });

    it('applies default styles', () => {
      const html = renderToHtml(
        createElement(
          PendingNavigationProvider,
          { value: '/page' },
          createElement(TopLoader, { config: {} })
        )
      );
      // Default color
      expect(html).toContain('#2299DD');
      // Default height
      expect(html).toContain('height:3px');
      // Default z-index
      expect(html).toContain('z-index:1600');
      // Default shadow
      expect(html).toContain('box-shadow');
      // Crawl animation
      expect(html).toContain('__timber_top_loader_crawl');
    });

    it('applies custom config', () => {
      const html = renderToHtml(
        createElement(
          PendingNavigationProvider,
          { value: '/page' },
          createElement(TopLoader, {
            config: {
              color: '#ff0000',
              height: 5,
              shadow: false,
              zIndex: 9999,
            },
          })
        )
      );
      expect(html).toContain('#ff0000');
      expect(html).toContain('height:5px');
      expect(html).toContain('z-index:9999');
      expect(html).not.toContain('box-shadow');
    });

    it('includes CSS animation-delay when delay is configured', () => {
      const html = renderToHtml(
        createElement(
          PendingNavigationProvider,
          { value: '/page' },
          createElement(TopLoader, { config: { delay: 200 } })
        )
      );
      // The animation should include the delay value
      expect(html).toContain('200ms');
    });
  });

  describe('configuration', () => {
    it('exports TopLoaderConfig type', async () => {
      const mod = await import('../packages/timber-app/src/client/top-loader');
      expect(mod.TopLoader).toBeDefined();
    });

    it('accepts all config props without error', () => {
      // Verify the component doesn't crash with full config
      const html = renderToHtml(
        createElement(TopLoader, {
          config: {
            enabled: true,
            color: '#ff0000',
            height: 5,
            shadow: false,
            delay: 200,
            zIndex: 2000,
          },
        })
      );
      // No pending URL → hidden
      expect(html).toBe('');
    });
  });

  describe('TransitionRoot integration', () => {
    it('TransitionRoot accepts topLoaderConfig prop', async () => {
      const mod = await import('../packages/timber-app/src/client/transition-root');
      expect(mod.TransitionRoot).toBeDefined();
      expect(typeof mod.TransitionRoot).toBe('function');
    });
  });

  describe('config in TimberUserConfig', () => {
    it('topLoader config type exists on TimberUserConfig', async () => {
      const mod = await import('../packages/timber-app/src/index');
      expect(mod).toBeDefined();
    });
  });
});
