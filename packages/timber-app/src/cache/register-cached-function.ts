import { createHash } from 'node:crypto';
import type { CacheHandler } from './index';
import { stableStringify } from './stable-stringify';
import { createSingleflight } from './singleflight';

const singleflight = createSingleflight();

// Prop names that suggest request-specific data — triggers dev warning for "use cache" components.
const REQUEST_SPECIFIC_PROPS = new Set([
  'cookies',
  'cookie',
  'session',
  'sessionId',
  'token',
  'authorization',
  'auth',
  'headers',
]);

export interface RegisterCachedFunctionOptions<Fn extends (...args: any[]) => any> {
  ttl: number;
  id: string;
  tags?: string[] | ((...args: Parameters<Fn>) => string[]);
  /** True when the cached function is a React component (PascalCase name). */
  isComponent?: boolean;
}

/**
 * Generate a SHA-256 cache key from a stable function ID and serialized args.
 */
function generateKey(id: string, args: unknown[]): string {
  const raw = id + ':' + stableStringify(args);
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Resolve tags from options — supports static array or function form.
 */
function resolveTags<Fn extends (...args: any[]) => any>(
  opts: RegisterCachedFunctionOptions<Fn>,
  args: Parameters<Fn>
): string[] {
  if (!opts.tags) return [];
  if (Array.isArray(opts.tags)) return opts.tags;
  return opts.tags(...args);
}

/**
 * Checks if component props contain request-specific keys and emits a dev warning.
 * Only runs when process.env.NODE_ENV !== 'production'.
 */
function warnRequestSpecificProps(id: string, props: unknown): void {
  if (typeof props !== 'object' || props === null) return;
  const keys = Object.keys(props);
  const suspicious = keys.filter((k) => REQUEST_SPECIFIC_PROPS.has(k.toLowerCase()));
  if (suspicious.length > 0) {
    console.warn(
      `[timber] "use cache" component ${id} received request-specific props: ${suspicious.join(', ')}. ` +
        `This may serve one user's cached render to another user. ` +
        `Remove request-specific data from props or remove "use cache".`
    );
  }
}

/**
 * Runtime for the "use cache" directive transform. Wraps an async function
 * with caching using the same cache handler as timber.cache.
 *
 * The stable `id` (file path + function name) ensures cache keys are consistent
 * across builds. Args/props are hashed with SHA-256 for the per-call key.
 */
export function registerCachedFunction<Fn extends (...args: any[]) => Promise<any>>(
  fn: Fn,
  opts: RegisterCachedFunctionOptions<Fn>,
  handler: CacheHandler
): (...args: Parameters<Fn>) => Promise<Awaited<ReturnType<Fn>>> {
  return async (...args: Parameters<Fn>): Promise<Awaited<ReturnType<Fn>>> => {
    // Dev-mode warning for components with request-specific props
    if (opts.isComponent && process.env.NODE_ENV !== 'production' && args.length > 0) {
      warnRequestSpecificProps(opts.id, args[0]);
    }

    const key = generateKey(opts.id, args);
    const cached = await handler.get(key);

    if (cached && !cached.stale) {
      return cached.value as Awaited<ReturnType<Fn>>;
    }

    // Cache miss or stale — execute with singleflight
    const result = await singleflight.do(key, () => fn(...args));
    const tags = resolveTags(opts, args);
    await handler.set(key, result, { ttl: opts.ttl, tags });
    return result as Awaited<ReturnType<Fn>>;
  };
}
