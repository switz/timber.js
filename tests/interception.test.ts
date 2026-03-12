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
});
