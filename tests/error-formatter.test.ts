import { describe, it, expect } from 'vitest';
import { formatSsrError } from '../packages/timber-app/src/server/error-formatter';

describe('formatSsrError', () => {
  it('filters vendor frames and shows user code from stack traces', () => {
    const error = new Error('Something failed');
    error.stack = `Error: Something failed
    at resolveErrorDev (.../node_modules/.vite/deps_ssr/@vitejs_plugin-rsc_vendor_react-server-dom_client__edge.js:4022:106)
    at userComponent (/app/src/components/MyButton.tsx:15:3)`;

    const result = formatSsrError(error);
    // Vendor frames are filtered out, user code frames are surfaced
    expect(result).toContain('MyButton.tsx:15:3');
    expect(result).toContain('User code in stack:');
    // Vendor paths should not appear in user frames
    expect(result).not.toContain('node_modules/.vite/deps_ssr/@vitejs_plugin-rsc_vendor');
  });

  it('rewrites __vite_ssr_export_default__ in error messages', () => {
    const error = new Error(
      'Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server".\n' +
        '  <... fallbackComponent={function __vite_ssr_export_default__} status=... children=...>'
    );
    error.stack = error.message;

    const result = formatSsrError(error);
    expect(result).toContain('<default export>');
    expect(result).not.toContain('__vite_ssr_export_default__');
  });

  it('rewrites named vite ssr exports', () => {
    const error = new Error('Bad value: __vite_ssr_export_MyComponent__');
    error.stack = error.message;

    const result = formatSsrError(error);
    expect(result).toContain('<export MyComponent>');
    expect(result).not.toContain('__vite_ssr_export_MyComponent__');
  });

  it('adds hint for function-passed-to-client-component errors', () => {
    const error = new Error('Functions cannot be passed directly to Client Components');
    error.stack = error.message;

    const result = formatSsrError(error);
    expect(result).toContain('mark it "use server"');
  });

  it('extracts prop name from JSX-like syntax in function error', () => {
    const error = new Error(
      'Functions cannot be passed directly to Client Components\n' +
        '  <... onClick={function handler} ...>'
    );
    error.stack = error.message;

    const result = formatSsrError(error);
    expect(result).toContain('Prop "onClick"');
  });

  it('adds hint for objects-as-children errors', () => {
    const error = new Error('Objects are not valid as a React child');
    error.stack = error.message;

    const result = formatSsrError(error);
    expect(result).toContain('convert to string or extract the value');
  });

  it('adds hint for null reference errors', () => {
    const error = new Error("Cannot read properties of undefined (reading 'title')");
    error.stack = error.message;

    const result = formatSsrError(error);
    expect(result).toContain('.title on undefined');
  });

  it('adds hint for element-type-invalid errors', () => {
    const error = new Error('Element type is invalid');
    error.stack = error.message;

    const result = formatSsrError(error);
    expect(result).toContain('check default exports and import paths');
  });

  it('adds hint for not-a-function errors', () => {
    const error = new Error('fetchData is not a function');
    error.stack = error.message;

    const result = formatSsrError(error);
    expect(result).toContain('"fetchData" is not a function');
  });

  it('extracts user-code frames from stack', () => {
    const error = new Error('fail');
    error.stack = `Error: fail
    at Object.render (node_modules/.vite/deps_ssr/@vitejs_plugin-rsc_vendor_react-server-dom_client__edge.js:100:10)
    at MyPage (/app/src/app/dashboard/page.tsx:22:5)
    at Layout (/app/src/app/layout.tsx:10:3)
    at processChild (node:internal/streams:42:12)`;

    const result = formatSsrError(error);
    expect(result).toContain('User code in stack:');
    expect(result).toContain('/app/src/app/dashboard/page.tsx:22:5');
    expect(result).toContain('/app/src/app/layout.tsx:10:3');
    // Should not include node_modules or node:internal frames
    expect(result).not.toContain('processChild');
  });

  it('limits user frames to 5', () => {
    const frames = Array.from(
      { length: 10 },
      (_, i) => `    at fn${i} (/app/src/file${i}.tsx:${i}:1)`
    ).join('\n');
    const error = new Error('fail');
    error.stack = `Error: fail\n${frames}`;

    const result = formatSsrError(error);
    const userFrameLines = result.split('\n').filter((l) => l.trim().startsWith('at '));
    expect(userFrameLines.length).toBeLessThanOrEqual(5);
  });

  it('handles non-Error values', () => {
    expect(formatSsrError('string error')).toBe('string error');
    expect(formatSsrError(42)).toBe('42');
    expect(formatSsrError(null)).toBe('null');
  });

  it('filters out generic .vite/deps_ssr frames', () => {
    const error = new Error('fail');
    error.stack = `Error: fail
    at something (node_modules/.vite/deps_ssr/some_other_dep.js:10:5)`;

    const result = formatSsrError(error);
    // Vendor frames are filtered — no user code frames remain
    expect(result).not.toContain('node_modules/.vite/deps_ssr/some_other_dep');
    expect(result).not.toContain('User code in stack:');
  });
});
