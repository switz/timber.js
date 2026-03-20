/**
 * Tests for dev-mode RSC prop serialization warnings.
 *
 * TIM-358: Add dev-mode warnings for non-serializable RSC props
 */

import { describe, expect, it } from 'vitest';
import {
  detectNonSerializableType,
  formatRscPropWarning,
} from '../packages/timber-app/src/server/rsc-prop-warnings.js';

// ---------------------------------------------------------------------------
// detectNonSerializableType
// ---------------------------------------------------------------------------

describe('detectNonSerializableType', () => {
  it('detects RegExp', () => {
    const result = detectNonSerializableType('Only plain objects can be passed to Client Components from Server Components. RegExp objects are not supported.');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('RegExp');
    expect(result!.suggestion).toContain('.toString()');
  });

  it('detects URL object mention', () => {
    const result = detectNonSerializableType('Only plain objects can be passed to Client Components from Server Components. URL objects are not supported.');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('URL');
    expect(result!.suggestion).toContain('.href');
  });

  it('detects class instances / null prototypes', () => {
    const result = detectNonSerializableType('Classes or null prototypes are not supported as the type of props passed to a Client Component');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('class instance');
    expect(result!.suggestion).toContain('plain object');
  });

  it('detects function passing', () => {
    const result = detectNonSerializableType('Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server"');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('function');
    expect(result!.suggestion).toContain('"use server"');
  });

  it('detects Symbol', () => {
    const result = detectNonSerializableType('Only plain objects can be passed to Client Components from Server Components. Symbol objects are not supported.');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('Symbol');
  });

  it('returns null for unrelated errors', () => {
    expect(detectNonSerializableType('Cannot read property of undefined')).toBeNull();
    expect(detectNonSerializableType('Unexpected token')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectNonSerializableType('')).toBeNull();
  });

  it('detects generic "Only plain objects" pattern', () => {
    const result = detectNonSerializableType('Only plain objects can be passed to Client Components from Server Components. Objects with toJSON methods are not supported. Convert it manually to a simple value before passing it to props.');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('non-serializable object');
  });
});

// ---------------------------------------------------------------------------
// formatRscPropWarning
// ---------------------------------------------------------------------------

describe('formatRscPropWarning', () => {
  it('formats a RegExp warning', () => {
    const msg = formatRscPropWarning({
      type: 'RegExp',
      suggestion: 'Use .toString() to serialize, and new RegExp() to reconstruct on the client.',
    });
    expect(msg).toContain('RegExp');
    expect(msg).toContain('.toString()');
    expect(msg).toContain('design/30-rsc-serialization-audit.md');
  });

  it('formats a URL warning', () => {
    const msg = formatRscPropWarning({
      type: 'URL',
      suggestion: 'Pass .href or .toString() instead of the URL object.',
    });
    expect(msg).toContain('URL');
    expect(msg).toContain('.href');
  });

  it('formats a class instance warning', () => {
    const msg = formatRscPropWarning({
      type: 'class instance',
      suggestion: 'Spread to a plain object: { ...instance } or extract the needed properties.',
    });
    expect(msg).toContain('class instance');
    expect(msg).toContain('plain object');
  });

  it('includes the request path when provided', () => {
    const msg = formatRscPropWarning(
      {
        type: 'RegExp',
        suggestion: 'Use .toString().',
      },
      '/products'
    );
    expect(msg).toContain('/products');
  });

  it('includes the original error message when provided', () => {
    const msg = formatRscPropWarning(
      {
        type: 'RegExp',
        suggestion: 'Use .toString().',
      },
      undefined,
      'Only plain objects can be passed'
    );
    expect(msg).toContain('Only plain objects');
  });
});
