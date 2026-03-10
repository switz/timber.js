import { describe, it, expect } from 'vitest';
import {
  detectFileDirective,
  findFunctionsWithDirective,
  containsDirective,
} from '../packages/timber-app/src/utils/directive-parser';

// ---------------------------------------------------------------------------
// File-level directive detection
// ---------------------------------------------------------------------------

describe('detectFileDirective', () => {
  it('detects "use client" with single quotes', () => {
    const code = `'use client'\n\nexport default function Page() { return <div /> }`;
    const result = detectFileDirective(code);
    expect(result).toEqual({ directive: 'use client', line: 1 });
  });

  it('detects "use client" with double quotes', () => {
    const code = `"use client"\n\nexport default function Page() { return <div /> }`;
    const result = detectFileDirective(code);
    expect(result).toEqual({ directive: 'use client', line: 1 });
  });

  it('detects "use server" directive', () => {
    const code = `'use server'\n\nexport async function action() { }`;
    const result = detectFileDirective(code);
    expect(result).toEqual({ directive: 'use server', line: 1 });
  });

  it('detects directive with semicolon', () => {
    const code = `'use client';\n\nexport default function Page() { return <div /> }`;
    const result = detectFileDirective(code);
    expect(result).toEqual({ directive: 'use client', line: 1 });
  });

  it('returns null when no directive present', () => {
    const code = `export default function Page() { return <div /> }`;
    const result = detectFileDirective(code);
    expect(result).toBeNull();
  });

  it('does not false-positive on directive inside a string', () => {
    const code = `const x = 'use client'\nexport default function Page() { return <div /> }`;
    const result = detectFileDirective(code);
    expect(result).toBeNull();
  });

  it('does not false-positive on directive inside a comment', () => {
    const code = `// 'use client'\nexport default function Page() { return <div /> }`;
    const result = detectFileDirective(code);
    expect(result).toBeNull();
  });

  it('does not false-positive on directive inside a block comment', () => {
    const code = `/* 'use client' */\nexport default function Page() { return <div /> }`;
    const result = detectFileDirective(code);
    expect(result).toBeNull();
  });

  it('does not false-positive on directive inside a template literal', () => {
    const code = "const x = `${'use client'}`\nexport default function Page() { return <div /> }";
    const result = detectFileDirective(code);
    expect(result).toBeNull();
  });

  it('detects directive after leading blank lines', () => {
    const code = `\n\n'use client'\n\nexport default function Page() { return <div /> }`;
    const result = detectFileDirective(code);
    expect(result).not.toBeNull();
    expect(result!.directive).toBe('use client');
  });

  it('accepts custom directive list', () => {
    const code = `'use cache'\nexport default function Page() { return <div /> }`;
    const result = detectFileDirective(code, ['use cache']);
    expect(result).toEqual({ directive: 'use cache', line: 1 });
  });

  it('returns null for non-matching custom directive', () => {
    const code = `'use client'\nexport default function Page() { return <div /> }`;
    const result = detectFileDirective(code, ['use cache']);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Function-body directive detection
// ---------------------------------------------------------------------------

describe('findFunctionsWithDirective', () => {
  describe('use cache', () => {
    it('finds named function with use cache', () => {
      const code = `async function fetchData() {\n  'use cache'\n  return await db.query()\n}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('fetchData');
      expect(results[0].directive).toBe('use cache');
    });

    it('finds exported function with use cache', () => {
      const code = `export async function getProducts() {\n  'use cache'\n  return await db.products.findAll()\n}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('getProducts');
      expect(results[0].prefix).toBe('export ');
    });

    it('finds export default function with use cache', () => {
      const code = `export default async function Dashboard() {\n  'use cache'\n  return await getStats()\n}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Dashboard');
      expect(results[0].prefix).toBe('export default ');
    });

    it('finds arrow function with use cache', () => {
      const code = `const fetchData = async () => {\n  'use cache'\n  return await db.query()\n}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('fetchData');
      expect(results[0].isArrow).toBe(true);
    });

    it('handles double quotes', () => {
      const code = `async function fetchData() {\n  "use cache"\n  return await db.query()\n}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('fetchData');
    });

    it('finds multiple functions, only those with directive', () => {
      const code = `
async function cachedFn() {
  'use cache'
  return await getData()
}

async function normalFn() {
  return await getOtherData()
}

async function anotherCachedFn() {
  'use cache'
  return await getMoreData()
}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name).sort();
      expect(names).toEqual(['anotherCachedFn', 'cachedFn']);
    });

    it('returns empty array when no functions have the directive', () => {
      const code = `async function normalFn() {\n  return await getData()\n}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(0);
    });

    it('does not false-positive on directive inside a string literal in function body', () => {
      const code = `async function fn() {\n  const x = 'use cache'\n  return x\n}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      // The string literal 'use cache' is a variable assignment, not a directive.
      // It's the first statement, but it's const x = ..., not a bare expression.
      expect(results).toHaveLength(0);
    });

    it('does not false-positive on directive inside a comment in function body', () => {
      const code = `async function fn() {\n  // 'use cache'\n  return await getData()\n}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(0);
    });

    it('does not false-positive on directive inside a template literal', () => {
      const code = "async function fn() {\n  const x = `${'use cache'}`\n  return x\n}";
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(0);
    });

    it('provides correct body content', () => {
      const code = `async function fetchData() {\n  'use cache'\n  return 42\n}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(1);
      expect(results[0].bodyContent).toContain("'use cache'");
      expect(results[0].bodyContent).toContain('return 42');
    });

    it('results sorted descending by start position', () => {
      const code = `
async function first() {
  'use cache'
  return 1
}
async function second() {
  'use cache'
  return 2
}`;
      const results = findFunctionsWithDirective(code, 'use cache');
      expect(results).toHaveLength(2);
      // Descending: second appears after first, so second.start > first.start
      expect(results[0].start).toBeGreaterThan(results[1].start);
    });
  });

  describe('use dynamic', () => {
    it('finds function with use dynamic', () => {
      const code = `async function DynamicComponent() {\n  'use dynamic'\n  return <div />\n}`;
      const results = findFunctionsWithDirective(code, 'use dynamic');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('DynamicComponent');
      expect(results[0].directive).toBe('use dynamic');
    });

    it('does not match use cache when looking for use dynamic', () => {
      const code = `async function fn() {\n  'use cache'\n  return 42\n}`;
      const results = findFunctionsWithDirective(code, 'use dynamic');
      expect(results).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Quick regex check
// ---------------------------------------------------------------------------

describe('containsDirective', () => {
  it('returns true when directive string is present', () => {
    expect(containsDirective("'use cache'", 'use cache')).toBe(true);
  });

  it('returns false when directive string is absent', () => {
    expect(containsDirective('const x = 1', 'use cache')).toBe(false);
  });
});
