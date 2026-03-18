import { describe, it, expect } from 'vitest';
import { renderDevErrorPage } from '../packages/timber-app/src/server/fallback-error';

describe('renderDevErrorPage', () => {
  it('returns a 500 HTML response with error details', async () => {
    const error = new Error('Module evaluation failed');
    error.stack = 'Error: Module evaluation failed\n    at Object.<anonymous> (app/page.tsx:5:1)';

    const res = renderDevErrorPage(error);

    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');

    const html = await res.text();
    expect(html).toContain('500 Internal Server Error');
    expect(html).toContain('Module evaluation failed');
    expect(html).toContain('app/page.tsx:5:1');
  });

  it('escapes HTML in error messages', async () => {
    const error = new Error('<script>alert("xss")</script>');
    const res = renderDevErrorPage(error);
    const html = await res.text();

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert');
  });

  it('handles non-Error values', async () => {
    const res = renderDevErrorPage('string error');
    const html = await res.text();

    expect(res.status).toBe(500);
    expect(html).toContain('string error');
  });

  it('handles errors without stack traces', async () => {
    const error = new Error('no stack');
    error.stack = undefined;

    const res = renderDevErrorPage(error);
    const html = await res.text();

    expect(res.status).toBe(500);
    expect(html).toContain('no stack');
    // Should not render the stack trace <div> element when no stack
    expect(html).not.toContain('<div class="stack-container">');
  });

  it('includes Vite client script for error overlay', async () => {
    const res = renderDevErrorPage(new Error('test'));
    const html = await res.text();

    expect(html).toContain('/@vite/client');
  });

  it('includes dev-only disclaimer', async () => {
    const res = renderDevErrorPage(new Error('test'));
    const html = await res.text();

    expect(html).toContain('only shown in development');
  });
});
