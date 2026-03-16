import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAppDir } from '../packages/timber-app/src/index';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'timber-appdir-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('resolveAppDir', () => {
  test('prefers app/ at root when it exists', () => {
    mkdirSync(join(tempDir, 'app'));
    const result = resolveAppDir(tempDir);
    expect(result).toBe(join(tempDir, 'app'));
  });

  test('falls back to src/app/ when app/ does not exist', () => {
    mkdirSync(join(tempDir, 'src', 'app'), { recursive: true });
    const result = resolveAppDir(tempDir);
    expect(result).toBe(join(tempDir, 'src', 'app'));
  });

  test('prefers app/ over src/app/ when both exist', () => {
    mkdirSync(join(tempDir, 'app'));
    mkdirSync(join(tempDir, 'src', 'app'), { recursive: true });
    const result = resolveAppDir(tempDir);
    expect(result).toBe(join(tempDir, 'app'));
  });

  test('throws when neither app/ nor src/app/ exists', () => {
    expect(() => resolveAppDir(tempDir)).toThrow(/Could not find app directory/);
  });

  test('uses explicit appDir from config', () => {
    mkdirSync(join(tempDir, 'custom', 'app'), { recursive: true });
    const result = resolveAppDir(tempDir, 'custom/app');
    expect(result).toBe(join(tempDir, 'custom', 'app'));
  });

  test('throws when explicit appDir does not exist', () => {
    expect(() => resolveAppDir(tempDir, 'nonexistent/app')).toThrow(
      /Configured appDir "nonexistent\/app" does not exist/
    );
  });
});
