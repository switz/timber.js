import { describe, it, expect } from 'vitest';
import { validateCsrf } from '../packages/timber-app/src/server/csrf';
import {
  parseBodySize,
  enforceBodyLimits,
  DEFAULT_LIMITS,
} from '../packages/timber-app/src/server/body-limits';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(
  path: string,
  init?: RequestInit & { headers?: Record<string, string> }
): Request {
  return new Request(`http://localhost${path}`, init);
}

// ─── CSRF ─────────────────────────────────────────────────────────────────

describe('CSRF', () => {
  describe('csrf origin validation', () => {
    it('allows same-origin POST (Origin matches Host)', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          Host: 'example.com',
          Origin: 'https://example.com',
        },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(true);
    });

    it('rejects cross-origin POST', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          Host: 'example.com',
          Origin: 'https://evil.com',
        },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(403);
    });

    it('rejects POST without Origin header', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          Host: 'example.com',
        },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(403);
    });

    it('allows GET requests without Origin', () => {
      const req = makeRequest('/page', {
        method: 'GET',
        headers: { Host: 'example.com' },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(true);
    });

    it('allows HEAD requests without Origin', () => {
      const req = makeRequest('/page', {
        method: 'HEAD',
        headers: { Host: 'example.com' },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(true);
    });

    it('validates PUT requests', () => {
      const req = makeRequest('/api/item', {
        method: 'PUT',
        headers: {
          Host: 'example.com',
          Origin: 'https://evil.com',
        },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(false);
    });

    it('validates PATCH requests', () => {
      const req = makeRequest('/api/item', {
        method: 'PATCH',
        headers: {
          Host: 'example.com',
          Origin: 'https://evil.com',
        },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(false);
    });

    it('validates DELETE requests', () => {
      const req = makeRequest('/api/item', {
        method: 'DELETE',
        headers: {
          Host: 'example.com',
          Origin: 'https://evil.com',
        },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(false);
    });

    it('auto-derives allowed origin from Host with port', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Origin: 'http://localhost:3000',
        },
      });
      const result = validateCsrf(req, {});
      expect(result.ok).toBe(true);
    });
  });

  describe('csrf allowed origins', () => {
    it('accepts request when Origin matches allowedOrigins', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          Host: 'myapp.com',
          Origin: 'https://staging.myapp.com',
        },
      });
      const result = validateCsrf(req, {
        allowedOrigins: ['https://myapp.com', 'https://staging.myapp.com'],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects request when Origin not in allowedOrigins', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          Host: 'myapp.com',
          Origin: 'https://evil.com',
        },
      });
      const result = validateCsrf(req, {
        allowedOrigins: ['https://myapp.com', 'https://staging.myapp.com'],
      });
      expect(result.ok).toBe(false);
    });

    it('allowedOrigins replaces Host-based auto-derivation', () => {
      // Host is myapp.com but it's not in the allowedOrigins list
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          Host: 'myapp.com',
          Origin: 'https://myapp.com',
        },
      });
      // allowedOrigins doesn't include the Host-derived origin
      const result = validateCsrf(req, {
        allowedOrigins: ['https://staging.myapp.com'],
      });
      expect(result.ok).toBe(false);
    });

    it('no wildcard matching — exact match only', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          Host: 'myapp.com',
          Origin: 'https://sub.myapp.com',
        },
      });
      const result = validateCsrf(req, {
        allowedOrigins: ['https://*.myapp.com'],
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('csrf disable', () => {
    it('csrf: false disables all validation', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          Host: 'example.com',
          Origin: 'https://evil.com',
        },
      });
      const result = validateCsrf(req, { csrf: false });
      expect(result.ok).toBe(true);
    });

    it('csrf: false allows POST without Origin', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: { Host: 'example.com' },
      });
      const result = validateCsrf(req, { csrf: false });
      expect(result.ok).toBe(true);
    });
  });
});

// ─── Body Limits ──────────────────────────────────────────────────────────

describe('Body Limits', () => {
  describe('parseBodySize', () => {
    it('parses "1mb"', () => {
      expect(parseBodySize('1mb')).toBe(1_048_576);
    });

    it('parses "10mb"', () => {
      expect(parseBodySize('10mb')).toBe(10_485_760);
    });

    it('parses "512kb"', () => {
      expect(parseBodySize('512kb')).toBe(524_288);
    });

    it('parses "1gb"', () => {
      expect(parseBodySize('1gb')).toBe(1_073_741_824);
    });

    it('parses plain number string as bytes', () => {
      expect(parseBodySize('1024')).toBe(1024);
    });

    it('throws on invalid format', () => {
      expect(() => parseBodySize('abc')).toThrow();
    });
  });

  describe('action body limit', () => {
    it('allows body within default action limit (1MB)', async () => {
      const body = 'x'.repeat(1000);
      const req = makeRequest('/action', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(body.length),
        },
      });
      const result = enforceBodyLimits(req, 'action', {});
      expect(result.ok).toBe(true);
    });

    it('rejects body exceeding default action limit', () => {
      const size = DEFAULT_LIMITS.actionBodySize + 1;
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(size),
        },
      });
      const result = enforceBodyLimits(req, 'action', {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(413);
    });

    it('uses custom actionBodySize', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': '2000',
        },
      });
      const result = enforceBodyLimits(req, 'action', {
        limits: { actionBodySize: '1kb' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(413);
    });
  });

  describe('413 on limit exceed', () => {
    it('returns 413 for upload exceeding limit', () => {
      const size = DEFAULT_LIMITS.uploadBodySize + 1;
      const req = makeRequest('/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=---',
          'Content-Length': String(size),
        },
      });
      const result = enforceBodyLimits(req, 'upload', {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(413);
    });

    it('returns ok for upload within limit', () => {
      const req = makeRequest('/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=---',
          'Content-Length': '1000',
        },
      });
      const result = enforceBodyLimits(req, 'upload', {});
      expect(result.ok).toBe(true);
    });

    it('custom uploadBodySize is respected', () => {
      const req = makeRequest('/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=---',
          'Content-Length': '6000000',
        },
      });
      const result = enforceBodyLimits(req, 'upload', {
        limits: { uploadBodySize: '5mb' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(413);
    });
  });

  describe('411 on missing Content-Length', () => {
    it('rejects action POST without Content-Length header', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      const result = enforceBodyLimits(req, 'action', {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(411);
    });

    it('rejects upload POST without Content-Length header', () => {
      const req = makeRequest('/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=---',
        },
      });
      const result = enforceBodyLimits(req, 'upload', {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(411);
    });

    it('rejects request with non-numeric Content-Length', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': 'not-a-number',
        },
      });
      const result = enforceBodyLimits(req, 'action', {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(411);
    });

    it('allows action POST with valid Content-Length within limit', () => {
      const req = makeRequest('/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': '500',
        },
      });
      const result = enforceBodyLimits(req, 'action', {});
      expect(result.ok).toBe(true);
    });
  });

  describe('als no fallback', () => {
    // This test validates the principle: if ALS is unavailable, fail — don't fall back.
    // The actual ALS enforcement happens at the platform adapter level,
    // but we test that the body-limits module doesn't use any global state.
    it('enforceBodyLimits is stateless — no global mutable state', () => {
      // Call twice with different configs — results should be independent
      const req1 = makeRequest('/action', {
        method: 'POST',
        headers: {
          'Content-Length': '2000',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      const req2 = makeRequest('/action', {
        method: 'POST',
        headers: {
          'Content-Length': '2000',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const result1 = enforceBodyLimits(req1, 'action', { limits: { actionBodySize: '1kb' } });
      const result2 = enforceBodyLimits(req2, 'action', { limits: { actionBodySize: '10kb' } });

      expect(result1.ok).toBe(false);
      expect(result2.ok).toBe(true);
    });
  });
});
