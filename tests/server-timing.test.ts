/**
 * Tests for Server-Timing header generation.
 *
 * LOCAL-290: Emit Server-Timing header in dev for async work visibility
 */

import { describe, expect, it } from 'vitest';
import {
  runWithTimingCollector,
  recordTiming,
  withTiming,
  getServerTimingHeader,
  sanitizeUrlForTiming,
} from '../packages/timber-app/src/server/server-timing.js';

// ---------------------------------------------------------------------------
// recordTiming + getServerTimingHeader
// ---------------------------------------------------------------------------

describe('recordTiming + getServerTimingHeader', () => {
  it('returns null outside a collector', () => {
    expect(getServerTimingHeader()).toBe(null);
  });

  it('returns null when no entries recorded', () => {
    runWithTimingCollector(() => {
      expect(getServerTimingHeader()).toBe(null);
    });
  });

  it('formats a single entry with dur only', () => {
    runWithTimingCollector(() => {
      recordTiming({ name: 'rsc', dur: 108 });
      expect(getServerTimingHeader()).toBe('rsc;dur=108');
    });
  });

  it('formats a single entry with desc', () => {
    runWithTimingCollector(() => {
      recordTiming({ name: 'rsc', dur: 108, desc: 'RSC render' });
      expect(getServerTimingHeader()).toBe('rsc;dur=108;desc="RSC render"');
    });
  });

  it('formats multiple entries comma-separated', () => {
    runWithTimingCollector(() => {
      recordTiming({ name: 'rsc', dur: 108, desc: 'RSC render' });
      recordTiming({ name: 'ssr', dur: 96, desc: 'SSR hydration' });
      expect(getServerTimingHeader()).toBe(
        'rsc;dur=108;desc="RSC render", ssr;dur=96;desc="SSR hydration"'
      );
    });
  });

  it('deduplicates names with suffix', () => {
    runWithTimingCollector(() => {
      recordTiming({ name: 'fetch', dur: 77, desc: 'GET api.example.com/products' });
      recordTiming({ name: 'fetch', dur: 33, desc: 'GET api.example.com/user' });
      const header = getServerTimingHeader()!;
      expect(header).toContain('fetch;dur=77');
      expect(header).toContain('fetch-1;dur=33');
    });
  });

  it('escapes quotes in desc', () => {
    runWithTimingCollector(() => {
      recordTiming({ name: 'test', dur: 10, desc: 'value "with" quotes' });
      expect(getServerTimingHeader()).toBe('test;dur=10;desc="value \\"with\\" quotes"');
    });
  });

  it('escapes backslashes in desc', () => {
    runWithTimingCollector(() => {
      recordTiming({ name: 'test', dur: 10, desc: 'path\\to\\file' });
      expect(getServerTimingHeader()).toBe('test;dur=10;desc="path\\\\to\\\\file"');
    });
  });

  it('truncates at 4KB header size limit', () => {
    runWithTimingCollector(() => {
      // Generate enough entries to exceed 4KB
      for (let i = 0; i < 200; i++) {
        recordTiming({ name: `metric-${i}`, dur: i, desc: `Description for metric ${i}` });
      }
      const header = getServerTimingHeader()!;
      expect(header.length).toBeLessThanOrEqual(4096);
      // Should have some entries but not all 200
      expect(header).toContain('metric-0');
    });
  });

  it('no-ops recordTiming outside collector', () => {
    // Should not throw
    recordTiming({ name: 'test', dur: 10 });
    expect(getServerTimingHeader()).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// withTiming
// ---------------------------------------------------------------------------

describe('withTiming', () => {
  it('records timing for sync function', async () => {
    await runWithTimingCollector(async () => {
      const result = await withTiming('test', 'Test phase', () => 42);
      expect(result).toBe(42);
      const header = getServerTimingHeader()!;
      expect(header).toContain('test;dur=');
      expect(header).toContain('desc="Test phase"');
    });
  });

  it('records timing for async function', async () => {
    await runWithTimingCollector(async () => {
      const result = await withTiming('async-test', 'Async phase', async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 'done';
      });
      expect(result).toBe('done');
      const header = getServerTimingHeader()!;
      expect(header).toContain('async-test;dur=');
      // Duration should be at least 10ms
      const match = header.match(/async-test;dur=(\d+)/);
      expect(match).toBeTruthy();
      expect(Number(match![1])).toBeGreaterThanOrEqual(9); // Allow 1ms tolerance
    });
  });

  it('records timing even when function throws', async () => {
    await runWithTimingCollector(async () => {
      try {
        await withTiming('error-phase', 'Error phase', () => {
          throw new Error('boom');
        });
      } catch {
        // Expected
      }
      const header = getServerTimingHeader()!;
      expect(header).toContain('error-phase;dur=');
    });
  });

  it('works without desc', async () => {
    await runWithTimingCollector(async () => {
      await withTiming('nodesc', undefined, () => null);
      expect(getServerTimingHeader()).toBe('nodesc;dur=0');
    });
  });

  it('no-ops outside collector but still runs function', async () => {
    const result = await withTiming('test', 'Test', () => 99);
    expect(result).toBe(99);
    expect(getServerTimingHeader()).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// sanitizeUrlForTiming
// ---------------------------------------------------------------------------

describe('sanitizeUrlForTiming', () => {
  it('strips query params', () => {
    expect(sanitizeUrlForTiming('https://api.example.com/products?page=1&limit=20')).toBe(
      'api.example.com/products'
    );
  });

  it('strips hash', () => {
    expect(sanitizeUrlForTiming('https://api.example.com/page#section')).toBe(
      'api.example.com/page'
    );
  });

  it('truncates long paths', () => {
    const longPath = '/a'.repeat(30); // 60 chars
    const result = sanitizeUrlForTiming(`https://example.com${longPath}`);
    expect(result.length).toBeLessThanOrEqual(70); // host + truncated path
    expect(result).toContain('...');
  });

  it('handles relative paths gracefully', () => {
    // Not a valid URL — falls back to raw string truncation
    expect(sanitizeUrlForTiming('/api/products')).toBe('/api/products');
  });

  it('truncates long non-URL strings', () => {
    const longStr = 'x'.repeat(100);
    const result = sanitizeUrlForTiming(longStr);
    expect(result.length).toBe(60);
    expect(result).toContain('...');
  });

  it('preserves short URLs', () => {
    expect(sanitizeUrlForTiming('https://api.example.com/data')).toBe('api.example.com/data');
  });
});

// ---------------------------------------------------------------------------
// Nested collectors (requests don't interfere)
// ---------------------------------------------------------------------------

describe('request isolation', () => {
  it('entries from different requests do not interfere', async () => {
    const results: (string | null)[] = [];

    await Promise.all([
      runWithTimingCollector(async () => {
        recordTiming({ name: 'req1', dur: 100 });
        await new Promise((r) => setTimeout(r, 5));
        results[0] = getServerTimingHeader();
      }),
      runWithTimingCollector(async () => {
        recordTiming({ name: 'req2', dur: 200 });
        await new Promise((r) => setTimeout(r, 5));
        results[1] = getServerTimingHeader();
      }),
    ]);

    expect(results[0]).toBe('req1;dur=100');
    expect(results[1]).toBe('req2;dur=200');
  });
});
