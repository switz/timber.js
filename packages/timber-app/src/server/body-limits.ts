/**
 * Request body size limits — returns 413 when exceeded.
 * See design/08-forms-and-actions.md §"FormData Limits"
 */

export interface BodyLimitsConfig {
  limits?: {
    actionBodySize?: string;
    uploadBodySize?: string;
    maxFields?: number;
  };
}

export type BodyLimitResult = { ok: true } | { ok: false; status: 411 | 413 };

export type BodyKind = 'action' | 'upload';

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

export const DEFAULT_LIMITS = {
  actionBodySize: 1 * MB,
  uploadBodySize: 10 * MB,
  maxFields: 100,
} as const;

const SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*(kb|mb|gb)?$/i;

/** Parse a human-readable size string ("1mb", "512kb", "1024") into bytes. */
export function parseBodySize(size: string): number {
  const match = SIZE_PATTERN.exec(size.trim());
  if (!match) {
    throw new Error(
      `Invalid body size format: "${size}". Expected format like "1mb", "512kb", or "1024".`
    );
  }

  const value = Number.parseFloat(match[1]);
  const unit = (match[2] ?? '').toLowerCase();

  switch (unit) {
    case 'kb':
      return Math.floor(value * KB);
    case 'mb':
      return Math.floor(value * MB);
    case 'gb':
      return Math.floor(value * GB);
    case '':
      return Math.floor(value);
    default:
      throw new Error(`Unknown size unit: "${unit}"`);
  }
}

/** Check whether a request body exceeds the configured size limit (stateless, no ALS). */
export function enforceBodyLimits(
  req: Request,
  kind: BodyKind,
  config: BodyLimitsConfig
): BodyLimitResult {
  const contentLength = req.headers.get('Content-Length');
  if (!contentLength) {
    // Reject requests without Content-Length — prevents body limit bypass via
    // chunked transfer-encoding. Browsers always send Content-Length for form POSTs.
    return { ok: false, status: 411 };
  }

  const bodySize = Number.parseInt(contentLength, 10);
  if (Number.isNaN(bodySize)) {
    return { ok: false, status: 411 };
  }

  const limit = resolveLimit(kind, config);
  return bodySize <= limit ? { ok: true } : { ok: false, status: 413 };
}

/** Check whether a FormData payload exceeds the configured field count limit. */
export function enforceFieldLimit(formData: FormData, config: BodyLimitsConfig): BodyLimitResult {
  const maxFields = config.limits?.maxFields ?? DEFAULT_LIMITS.maxFields;
  // Count unique keys — FormData.keys() yields duplicates for multi-value fields,
  // so we use a Set to count distinct field names.
  const fieldCount = new Set(formData.keys()).size;
  return fieldCount <= maxFields ? { ok: true } : { ok: false, status: 413 };
}

/**
 * Resolve the byte limit for a given body kind, using config overrides or defaults.
 */
function resolveLimit(kind: BodyKind, config: BodyLimitsConfig): number {
  const userLimits = config.limits;

  if (kind === 'action') {
    return userLimits?.actionBodySize
      ? parseBodySize(userLimits.actionBodySize)
      : DEFAULT_LIMITS.actionBodySize;
  }

  return userLimits?.uploadBodySize
    ? parseBodySize(userLimits.uploadBodySize)
    : DEFAULT_LIMITS.uploadBodySize;
}
