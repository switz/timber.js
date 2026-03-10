import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serveStaticFile } from '../packages/timber-app/src/adapters/static-files';
import { IMMUTABLE_CACHE, STATIC_CACHE } from '../packages/timber-app/src/server/asset-headers';

const TEST_DIR = join(tmpdir(), 'timber-static-test-' + Date.now());

beforeAll(() => {
  mkdirSync(join(TEST_DIR, 'assets'), { recursive: true });
  writeFileSync(join(TEST_DIR, 'assets', 'app-a1b2c3d4.js'), 'console.log("hello")');
  writeFileSync(join(TEST_DIR, 'assets', 'style-deadbeef.css'), 'body { color: red }');
  writeFileSync(join(TEST_DIR, 'favicon.ico'), 'icon-data');
  writeFileSync(join(TEST_DIR, 'robots.txt'), 'User-agent: *');
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── serveStaticFile ──────────────────────────────────────────────────────

describe('serveStaticFile()', () => {
  it('serves existing files with correct content', async () => {
    const res = await serveStaticFile('/assets/app-a1b2c3d4.js', TEST_DIR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toBe('console.log("hello")');
  });

  it('sets immutable Cache-Control for hashed assets', async () => {
    const res = await serveStaticFile('/assets/app-a1b2c3d4.js', TEST_DIR);
    expect(res!.headers.get('Cache-Control')).toBe(IMMUTABLE_CACHE);
  });

  it('sets short-lived Cache-Control for unhashed assets', async () => {
    const res = await serveStaticFile('/favicon.ico', TEST_DIR);
    expect(res!.headers.get('Cache-Control')).toBe(STATIC_CACHE);
  });

  it('sets correct Content-Type for JS files', async () => {
    const res = await serveStaticFile('/assets/app-a1b2c3d4.js', TEST_DIR);
    expect(res!.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');
  });

  it('sets correct Content-Type for CSS files', async () => {
    const res = await serveStaticFile('/assets/style-deadbeef.css', TEST_DIR);
    expect(res!.headers.get('Content-Type')).toBe('text/css; charset=utf-8');
  });

  it('sets Content-Length header', async () => {
    const res = await serveStaticFile('/robots.txt', TEST_DIR);
    expect(res!.headers.get('Content-Length')).toBe('13');
  });

  it('returns null for non-existent files', async () => {
    const res = await serveStaticFile('/does-not-exist.js', TEST_DIR);
    expect(res).toBeNull();
  });

  it('returns null for directory traversal attempts', async () => {
    const res = await serveStaticFile('/../../../etc/passwd', TEST_DIR);
    expect(res).toBeNull();
  });

  it('returns null for null byte injection', async () => {
    const res = await serveStaticFile('/assets/app\0.js', TEST_DIR);
    expect(res).toBeNull();
  });

  it('strips query strings from path', async () => {
    const res = await serveStaticFile('/favicon.ico?v=123', TEST_DIR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });

  it('returns null for directories', async () => {
    const res = await serveStaticFile('/assets', TEST_DIR);
    expect(res).toBeNull();
  });
});
