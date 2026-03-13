/**
 * Tests for the clientJavascript config option.
 *
 * Validates:
 * - Boolean shorthand (`clientJavascript: false`)
 * - Object form (`clientJavascript: { disabled: true, enableHMRInDev: true }`)
 * - Deprecated `noClientJavascript` fallback with warning
 * - `enableHMRInDev` defaults to `true` when `disabled` is true
 * - `buildClientScripts` respects `enableHMRInDev` in dev mode
 *
 * Task: TIM-299
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveClientJavascript } from '../packages/timber-app/src/index';
import { buildClientScripts } from '../packages/timber-app/src/server/html-injectors';

// ─── resolveClientJavascript ─────────────────────────────────────────────────

describe('resolveClientJavascript', () => {
  describe('clientJavascript not specified', () => {
    it('defaults to enabled', () => {
      const result = resolveClientJavascript({});
      expect(result).toEqual({ disabled: false, enableHMRInDev: false });
    });
  });

  describe('boolean shorthand', () => {
    it('clientJavascript: false → disabled with enableHMRInDev', () => {
      const result = resolveClientJavascript({ clientJavascript: false });
      expect(result).toEqual({ disabled: true, enableHMRInDev: true });
    });

    it('clientJavascript: true → enabled', () => {
      const result = resolveClientJavascript({ clientJavascript: true });
      expect(result).toEqual({ disabled: false, enableHMRInDev: false });
    });
  });

  describe('object form', () => {
    it('disabled: true defaults enableHMRInDev to true', () => {
      const result = resolveClientJavascript({
        clientJavascript: { disabled: true },
      });
      expect(result).toEqual({ disabled: true, enableHMRInDev: true });
    });

    it('disabled: true with explicit enableHMRInDev: false', () => {
      const result = resolveClientJavascript({
        clientJavascript: { disabled: true, enableHMRInDev: false },
      });
      expect(result).toEqual({ disabled: true, enableHMRInDev: false });
    });

    it('disabled: false', () => {
      const result = resolveClientJavascript({
        clientJavascript: { disabled: false },
      });
      expect(result).toEqual({ disabled: false, enableHMRInDev: false });
    });
  });

  describe('deprecated noClientJavascript', () => {
    it('falls back to noClientJavascript when clientJavascript is not set', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = resolveClientJavascript({ noClientJavascript: true });
      expect(result).toEqual({ disabled: true, enableHMRInDev: true });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
      warnSpy.mockRestore();
    });

    it('noClientJavascript: false produces enabled config', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = resolveClientJavascript({ noClientJavascript: false });
      expect(result).toEqual({ disabled: false, enableHMRInDev: false });
      warnSpy.mockRestore();
    });

    it('clientJavascript takes precedence over noClientJavascript', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = resolveClientJavascript({
        clientJavascript: false,
        noClientJavascript: false,
      });
      // clientJavascript wins
      expect(result.disabled).toBe(true);
      // No deprecation warning because clientJavascript was specified
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});

// ─── buildClientScripts with enableHMRInDev ─────────────────────────────────

describe('buildClientScripts enableHMRInDev', () => {
  it('disabled + enableHMRInDev: true injects HMR client in dev', () => {
    const result = buildClientScripts({
      output: 'server',
      clientJavascript: { disabled: true, enableHMRInDev: true },
      dev: true,
    });
    expect(result.bootstrapScriptContent).toBe('import("/@vite/client")');
    expect(result.preloadLinks).toBe('');
  });

  it('disabled + enableHMRInDev: true returns empty in prod', () => {
    const result = buildClientScripts({
      output: 'server',
      clientJavascript: { disabled: true, enableHMRInDev: true },
      dev: false,
    });
    expect(result.bootstrapScriptContent).toBe('');
    expect(result.preloadLinks).toBe('');
  });

  it('disabled + enableHMRInDev: false returns empty in dev', () => {
    const result = buildClientScripts({
      output: 'server',
      clientJavascript: { disabled: true, enableHMRInDev: false },
      dev: true,
    });
    expect(result.bootstrapScriptContent).toBe('');
    expect(result.preloadLinks).toBe('');
  });

  it('enabled config returns full bootstrap in dev', () => {
    const result = buildClientScripts({
      output: 'server',
      clientJavascript: { disabled: false, enableHMRInDev: false },
      dev: true,
    });
    expect(result.bootstrapScriptContent).toContain('import("/@vite/client")');
    expect(result.bootstrapScriptContent).toContain('virtual:vite-rsc/entry-browser');
  });
});
