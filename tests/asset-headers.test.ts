import { describe, it, expect } from 'vitest';
import {
  isHashedAsset,
  getAssetCacheControl,
  IMMUTABLE_CACHE,
  STATIC_CACHE,
} from '../packages/timber-app/src/server/asset-headers';

// ─── isHashedAsset ────────────────────────────────────────────────────────

describe('isHashedAsset()', () => {
  it('matches Vite hashed JS files', () => {
    expect(isHashedAsset('/assets/layout-a1b2c3d4.js')).toBe(true);
    expect(isHashedAsset('/assets/chunk-e5f6a7b8.js')).toBe(true);
  });

  it('matches Vite hashed CSS files', () => {
    expect(isHashedAsset('/assets/root-abcdef01.css')).toBe(true);
    expect(isHashedAsset('/assets/page-12345678.css')).toBe(true);
  });

  it('matches dot-separated hash pattern', () => {
    expect(isHashedAsset('/assets/chunk.a1b2c3d4.js')).toBe(true);
    expect(isHashedAsset('/assets/vendor.deadbeef.css')).toBe(true);
  });

  it('matches longer hashes', () => {
    expect(isHashedAsset('/assets/app-a1b2c3d4e5f6a7b8.js')).toBe(true);
  });

  it('does not match unhashed files', () => {
    expect(isHashedAsset('/favicon.ico')).toBe(false);
    expect(isHashedAsset('/index.html')).toBe(false);
    expect(isHashedAsset('/robots.txt')).toBe(false);
    expect(isHashedAsset('/manifest.json')).toBe(false);
  });

  it('does not match short non-hash patterns', () => {
    expect(isHashedAsset('/assets/app.js')).toBe(false);
    expect(isHashedAsset('/assets/style.css')).toBe(false);
  });

  it('does not match paths without extensions', () => {
    expect(isHashedAsset('/assets/chunk-a1b2c3d4')).toBe(false);
  });
});

// ─── getAssetCacheControl ─────────────────────────────────────────────────

describe('getAssetCacheControl()', () => {
  it('returns immutable cache for hashed assets', () => {
    expect(getAssetCacheControl('/assets/layout-a1b2c3d4.js')).toBe(IMMUTABLE_CACHE);
    expect(getAssetCacheControl('/assets/root-abcdef01.css')).toBe(IMMUTABLE_CACHE);
  });

  it('returns short-lived cache for unhashed assets', () => {
    expect(getAssetCacheControl('/favicon.ico')).toBe(STATIC_CACHE);
    expect(getAssetCacheControl('/robots.txt')).toBe(STATIC_CACHE);
  });

  it('IMMUTABLE_CACHE contains immutable directive', () => {
    expect(IMMUTABLE_CACHE).toContain('immutable');
    expect(IMMUTABLE_CACHE).toContain('max-age=31536000');
    expect(IMMUTABLE_CACHE).toContain('public');
  });

  it('STATIC_CACHE contains must-revalidate directive', () => {
    expect(STATIC_CACHE).toContain('must-revalidate');
    expect(STATIC_CACHE).toContain('public');
  });
});
