/**
 * useCookie — reactive client-side cookie hook.
 *
 * Uses useSyncExternalStore for SSR-safe, reactive cookie access.
 * All components reading the same cookie name re-render on change.
 * No cross-tab sync (intentional — see design/29-cookies.md).
 *
 * See design/29-cookies.md §"useCookie(name) Hook"
 */

import { useSyncExternalStore } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ClientCookieOptions {
  /** URL path scope. Default: '/'. */
  path?: string;
  /** Domain scope. Default: omitted (current domain). */
  domain?: string;
  /** Max age in seconds. */
  maxAge?: number;
  /** Expiration date. */
  expires?: Date;
  /** Cross-site policy. Default: 'lax'. */
  sameSite?: 'strict' | 'lax' | 'none';
  /** Only send over HTTPS. Default: true in production. */
  secure?: boolean;
}

export type CookieSetter = (value: string, options?: ClientCookieOptions) => void;

// ─── Module-Level Cookie Store ────────────────────────────────────────────

type Listener = () => void;

/** Per-name subscriber sets. */
const listeners = new Map<string, Set<Listener>>();

/** Parse a cookie name from document.cookie. */
function getCookieValue(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*([^;]*)')
  );
  return match ? decodeURIComponent(match[1]) : undefined;
}

/** Serialize options into a cookie string suffix. */
function serializeOptions(options?: ClientCookieOptions): string {
  if (!options) return '; Path=/; SameSite=Lax';
  const parts: string[] = [];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  const sameSite = options.sameSite ?? 'lax';
  parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
  if (options.secure) parts.push('Secure');
  return '; ' + parts.join('; ');
}

/** Notify all subscribers for a given cookie name. */
function notify(name: string): void {
  const subs = listeners.get(name);
  if (subs) {
    for (const fn of subs) fn();
  }
}

// ─── Server Snapshot Registry ─────────────────────────────────────────────

/**
 * Server-side cookie values, populated during SSR via setServerCookieSnapshot.
 * Used as the server snapshot for useSyncExternalStore.
 */
let serverCookies: Map<string, string> | undefined;

/**
 * Set the server cookie snapshot. Called by the framework during SSR
 * to provide cookie values from the ALS-backed cookies() accessor.
 */
export function setServerCookieSnapshot(cookies: Map<string, string>): void {
  serverCookies = cookies;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

/**
 * Reactive hook for reading/writing a client-side cookie.
 *
 * Returns `[value, setCookie, deleteCookie]`:
 * - `value`: current cookie value (string | undefined)
 * - `setCookie`: sets the cookie and triggers re-renders
 * - `deleteCookie`: deletes the cookie and triggers re-renders
 *
 * @param name - Cookie name.
 * @param defaultOptions - Default options for setCookie calls.
 */
export function useCookie(
  name: string,
  defaultOptions?: ClientCookieOptions
): [value: string | undefined, setCookie: CookieSetter, deleteCookie: () => void] {
  const subscribe = (callback: Listener): (() => void) => {
    let subs = listeners.get(name);
    if (!subs) {
      subs = new Set();
      listeners.set(name, subs);
    }
    subs.add(callback);
    return () => {
      subs!.delete(callback);
      if (subs!.size === 0) listeners.delete(name);
    };
  };

  const getSnapshot = (): string | undefined => getCookieValue(name);
  const getServerSnapshot = (): string | undefined => serverCookies?.get(name);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setCookie: CookieSetter = (newValue: string, options?: ClientCookieOptions) => {
    const merged = { ...defaultOptions, ...options };
    document.cookie = `${name}=${encodeURIComponent(newValue)}${serializeOptions(merged)}`;
    notify(name);
  };

  const deleteCookie = (): void => {
    const path = defaultOptions?.path ?? '/';
    const domain = defaultOptions?.domain;
    let cookieStr = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=${path}`;
    if (domain) cookieStr += `; Domain=${domain}`;
    document.cookie = cookieStr;
    notify(name);
  };

  return [value, setCookie, deleteCookie];
}
