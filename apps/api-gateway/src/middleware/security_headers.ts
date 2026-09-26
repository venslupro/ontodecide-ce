/**
 * @fileoverview Security response headers for API responses.
 */

import {withHeaders} from '../http';
import type {Middleware} from './chain';

/** Headers set on every API response (except WebSocket upgrades). */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

/** Security headers step. */
export function securityHeaders(): Middleware {
  return async (_s, next) => withHeaders(await next(), SECURITY_HEADERS);
}
