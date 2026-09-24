/**
 * @fileoverview Cookie parsing and the refresh-token cookie.
 */

import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_SEC,
} from '@ontodecide/identity/contract';

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

function attrs(secure: boolean, maxAge: number): string {
  return [
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
  ].join('; ');
}

/** `Set-Cookie` value carrying a refresh token. */
export function refreshCookie(token: string, secure: boolean): string {
  return `${REFRESH_COOKIE}=${encodeURIComponent(token)}; ${attrs(
    secure,
    REFRESH_TOKEN_TTL_SEC,
  )}`;
}

/** `Set-Cookie` value that clears the refresh cookie. */
export function clearRefreshCookie(secure: boolean): string {
  return `${REFRESH_COOKIE}=; ${attrs(secure, 0)}`;
}
