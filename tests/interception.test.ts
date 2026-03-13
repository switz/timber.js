/**
 * Tests for intercepting route rewrite generation.
 *
 * Verifies that the route tree scanner correctly generates conditional
 * rewrite rules for intercepting routes based on the (.), (..), (...),
 * and (..)(..) markers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { scanRoutes } from '@timber/app/routing';
import { collectInterceptionRewrites } from '../packages/timber-app/src/routing/interception';

const TMP_DIR = join(import.meta.dirname, '.tmp-interception-test');

function appDir(): string {
  return join(TMP_DIR, 'app');
}

function createFile(path: string, content = ''): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function createApp(files: Record<string, string>): string {
  const root = appDir();
  mkdirSync(root, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    createFile(join(root, filePath), content);
  }
  return root;
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('collectInterceptionRewrites', () => {
  it('generates rewrite for (.) same-level interception', () => {
    const root = createApp({
      'feed/page.tsx': '',
      'feed/@modal/(.)photo/[id]/page.tsx': '',
      'feed/@modal/default.tsx': '',
      'photo/[id]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const rewrites = collectInterceptionRewrites(tree.root);

    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].interceptedPattern).toBe('/feed/photo/[id]');
    expect(rewrites[0].interceptingPrefix).toBe('/feed');
  });

  it('generates rewrite for (..) one-level-up interception', () => {
    const root = createApp({
      'feed/page.tsx': '',
      'feed/comments/@modal/(..)photo/[id]/page.tsx': '',
      'feed/comments/@modal/default.tsx': '',
      'feed/comments/page.tsx': '',
      'feed/photo/[id]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const rewrites = collectInterceptionRewrites(tree.root);

    expect(rewrites).toHaveLength(1);
    // (..) from /feed/comments → one level up → /feed
    expect(rewrites[0].interceptedPattern).toBe('/feed/photo/[id]');
    expect(rewrites[0].interceptingPrefix).toBe('/feed/comments');
  });

  it('generates rewrite for (...) root-level interception', () => {
    const root = createApp({
      'feed/page.tsx': '',
      'feed/@modal/(...)photo/[id]/page.tsx': '',
      'feed/@modal/default.tsx': '',
      'photo/[id]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const rewrites = collectInterceptionRewrites(tree.root);

    expect(rewrites).toHaveLength(1);
    // (...) → root level
    expect(rewrites[0].interceptedPattern).toBe('/photo/[id]');
    expect(rewrites[0].interceptingPrefix).toBe('/feed');
  });

  it('generates rewrite for (..)(..) two-levels-up interception', () => {
    const root = createApp({
      'a/b/c/page.tsx': '',
      'a/b/c/@modal/(..)(..)photo/page.tsx': '',
      'a/b/c/@modal/default.tsx': '',
      'a/photo/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const rewrites = collectInterceptionRewrites(tree.root);

    expect(rewrites).toHaveLength(1);
    // (..)(..) from /a/b/c → two levels up → /a
    expect(rewrites[0].interceptedPattern).toBe('/a/photo');
    expect(rewrites[0].interceptingPrefix).toBe('/a/b/c');
  });

  it('returns empty array when no intercepting routes exist', () => {
    const root = createApp({
      'feed/page.tsx': '',
      'photo/[id]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const rewrites = collectInterceptionRewrites(tree.root);
    expect(rewrites).toHaveLength(0);
  });

  it('(..) climbs visible URL segments, not filesystem dirs (skips route groups)', () => {
    // Route group (marketing) is a filesystem dir but invisible in URLs.
    // (..) should climb one visible segment, not one filesystem dir.
    const root = createApp({
      '(marketing)/shop/page.tsx': '',
      '(marketing)/shop/@modal/(..)photo/[id]/page.tsx': '',
      '(marketing)/shop/@modal/default.tsx': '',
      '(marketing)/photo/[id]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const rewrites = collectInterceptionRewrites(tree.root);

    expect(rewrites).toHaveLength(1);
    // (..) from /shop should climb one visible segment → /
    // (not stay at /shop because (marketing) "wasted" a climb)
    expect(rewrites[0].interceptedPattern).toBe('/photo/[id]');
    expect(rewrites[0].interceptingPrefix).toBe('/shop');
  });

  it('(..)(..) climbs visible URL segments through nested route groups', () => {
    // Two route groups in the ancestor chain should not waste climb levels
    const root = createApp({
      '(org)/dashboard/(team)/projects/page.tsx': '',
      '(org)/dashboard/(team)/projects/@modal/(..)(..)settings/page.tsx': '',
      '(org)/dashboard/(team)/projects/@modal/default.tsx': '',
      '(org)/dashboard/settings/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const rewrites = collectInterceptionRewrites(tree.root);

    expect(rewrites).toHaveLength(1);
    // (..)(..) from /dashboard/projects → two visible segments up → /
    // Route groups (org) and (team) should not count as levels
    expect(rewrites[0].interceptedPattern).toBe('/settings');
    expect(rewrites[0].interceptingPrefix).toBe('/dashboard/projects');
  });

  it('(..) works correctly when slot is inside a route group', () => {
    const root = createApp({
      'feed/page.tsx': '',
      'feed/(detail)/@modal/(..)photo/[id]/page.tsx': '',
      'feed/(detail)/@modal/default.tsx': '',
      'photo/[id]/page.tsx': '',
    });

    const tree = scanRoutes(root);
    const rewrites = collectInterceptionRewrites(tree.root);

    expect(rewrites).toHaveLength(1);
    // (..) from /feed → one visible segment up → /
    // The (detail) group between feed and @modal doesn't add URL depth
    expect(rewrites[0].interceptedPattern).toBe('/photo/[id]');
    expect(rewrites[0].interceptingPrefix).toBe('/feed');
  });
});
