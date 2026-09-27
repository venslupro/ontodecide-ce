/**
 * @fileoverview The refresh-token cookie `__Host-od_rt` (修订说明书 5.4):
 * HttpOnly, Secure, SameSite=Strict, Path=/, no Domain. The refresh token
 * never appears in a response body.
 */

import {REFRESH_COOKIE} from '@ontodecide/shared-kernel';

/** Parses a `Cookie` header into a map (first occurrence wins). */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name || name in out) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

/** Reads the refresh token from a request. */
export function readRefreshCookie(headers: Headers): string | undefined {
  return parseCookies(headers.get('cookie'))[REFRESH_COOKIE] || undefined;
}

const ATTRS = 'HttpOnly; Secure; SameSite=Strict; Path=/';

/**
 * `Set-Cookie` value carrying a refresh token that expires at
 * `expiresAtMs` (Unix ms, from `refreshExpiresAt`).
 */
export function refreshCookie(
  token: string,
  expiresAtMs: number,
  nowMs: number,
): string {
  const maxAge = Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));
  const expires = new Date(expiresAtMs).toUTCString();
  return `${REFRESH_COOKIE}=${encodeURIComponent(token)}; ${ATTRS}; Expires=${expires}; Max-Age=${maxAge}`;
}

/** `Set-Cookie` value that clears the refresh cookie. */
export function clearRefreshCookie(): string {
  return `${REFRESH_COOKIE}=; ${ATTRS}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
}
