/**
 * @fileoverview Security response headers (修订说明书 4.4): CSP with
 * `connect-src 'self'` (same origin only) and Turnstile as the only third
 * party, nosniff, strict-origin-when-cross-origin, HSTS and `no-store` for
 * every API response. WebSocket upgrades are passed through untouched.
 */

import {withHeaders} from '../http';
import type {Middleware} from './chain';

/** Content-Security-Policy of API responses (same as the Pages `_headers`). */
export const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self' 'unsafe-eval' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
].join('; ');

/** Headers set on every API response. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=15552000; includeSubDomains',
  'cache-control': 'no-store',
};

/** Security headers step. */
export function securityHeaders(): Middleware {
  return async (_s, next) => withHeaders(await next(), {...SECURITY_HEADERS});
}
