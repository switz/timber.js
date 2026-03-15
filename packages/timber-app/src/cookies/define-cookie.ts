/**
 * defineCookie — typed cookie definitions.
 *
 * Bundles name + codec + options into a reusable CookieDefinition<T>
 * with .get(), .set(), .delete() server methods and a .useCookie() client hook.
 *
 * Reuses the SearchParamCodec protocol via fromSchema() bridge.
 * Validation on read returns the codec default (never throws).
 *
 * See design/29-cookies.md §"Typed Cookies with Schema Validation"
 */

import { cookies } from '#/server/request-context.js';
import type { CookieOptions } from '#/server/request-context.js';
import { useCookie as useRawCookie } from '#/client/use-cookie.js';
import type { ClientCookieOptions } from '#/client/use-cookie.js';

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * A codec that converts between string cookie values and typed values.
 * Intentionally identical to SearchParamCodec<T>.
 */
export interface CookieCodec<T> {
  parse(value: string | string[] | undefined): T;
  serialize(value: T): string | null;
}

/** Options for defineCookie: codec + CookieOptions merged. */
export interface DefineCookieOptions<T> extends Omit<CookieOptions, 'signed'> {
  /** Codec for parsing/serializing the cookie value. */
  codec: CookieCodec<T>;
  /** Sign the cookie with HMAC-SHA256. */
  signed?: boolean;
}

/** A fully typed cookie definition with server and client methods. */
export interface CookieDefinition<T> {
  /** The cookie name. */
  readonly name: string;
  /** The resolved cookie options (without codec). */
  readonly options: CookieOptions;
  /** The codec used for parsing/serializing. */
  readonly codec: CookieCodec<T>;

  /** Server: read the typed value from the current request. */
  get(): T;
  /** Server: set the typed value on the response. */
  set(value: T): void;
  /** Server: delete the cookie. */
  delete(): void;

  /** Client: React hook for reading/writing this cookie. Returns [value, setter, deleter]. */
  useCookie(): [T, (value: T) => void, () => void];
}

// ─── Factory ──────────────────────────────────────────────────────────────

/**
 * Define a typed cookie.
 *
 * ```ts
 * import { defineCookie } from '@timber/app/cookies';
 * import { fromSchema } from '@timber/app/search-params';
 * import { z } from 'zod/v4';
 *
 * export const themeCookie = defineCookie('theme', {
 *   codec: fromSchema(z.enum(['light', 'dark', 'system']).default('system')),
 *   httpOnly: false,
 *   maxAge: 60 * 60 * 24 * 365,
 * });
 * ```
 */
export function defineCookie<T>(
  name: string,
  options: DefineCookieOptions<T>
): CookieDefinition<T> {
  const { codec, ...cookieOpts } = options;
  const resolvedOptions: CookieOptions = { ...cookieOpts };

  return {
    name,
    options: resolvedOptions,
    codec,

    get(): T {
      const jar = cookies();
      const raw = resolvedOptions.signed ? jar.getSigned(name) : jar.get(name);
      return codec.parse(raw);
    },

    set(value: T): void {
      const serialized = codec.serialize(value);
      if (serialized === null) {
        cookies().delete(name, {
          path: resolvedOptions.path,
          domain: resolvedOptions.domain,
        });
      } else {
        cookies().set(name, serialized, resolvedOptions);
      }
    },

    delete(): void {
      cookies().delete(name, {
        path: resolvedOptions.path,
        domain: resolvedOptions.domain,
      });
    },

    useCookie(): [T, (value: T) => void, () => void] {
      // Extract client-safe options (no httpOnly — client cookies can't be httpOnly)
      const clientOpts: ClientCookieOptions = {
        path: resolvedOptions.path,
        domain: resolvedOptions.domain,
        maxAge: resolvedOptions.maxAge,
        expires: resolvedOptions.expires,
        sameSite: resolvedOptions.sameSite,
        secure: resolvedOptions.secure,
      };

      const [raw, setRaw, deleteRaw] = useRawCookie(name, clientOpts);
      const parsed = codec.parse(raw);

      const setTyped = (value: T): void => {
        const serialized = codec.serialize(value);
        if (serialized === null) {
          deleteRaw();
        } else {
          setRaw(serialized);
        }
      };

      return [parsed, setTyped, deleteRaw];
    },
  };
}
