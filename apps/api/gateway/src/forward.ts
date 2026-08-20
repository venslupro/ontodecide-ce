/**
 * Request-forwarding helper.
 *
 * Builds the downstream `Request` from the inbound request and the injected
 * identity headers, then `fetch`es the target. The response is returned
 * verbatim (status + body), so the Gateway behaves as a transparent proxy
 * with auth/ratelimit sidecars.
 */
import {withIdentityHeaders} from './middlewares/tenant.js';
import type {AuthContext} from './middlewares/auth.js';

/** Build the downstream URL: `baseUrl + originalPath + querystring`. */
export function buildDownstreamUrl(baseUrl: string, originalUrl: string): string {
  const parsed = new URL(originalUrl);
  // Strip the `/api` prefix so downstream services receive the bare path.
  // (Each downstream service mounts its router under `/`.)
  let path = parsed.pathname;
  if (path.startsWith('/api')) {
    path = path.slice('/api'.length);
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
  }
  const base = baseUrl.replace(/\/$/, '');
  return `${base}${path}${parsed.search}`;
}

/** Forward the inbound request to the downstream service. */
export async function forwardRequest(
    request: Request,
    targetUrl: string,
    auth: AuthContext,
): Promise<Response> {
  const headers = withIdentityHeaders(request.headers, auth);
  const init: RequestInit = {
    method: request.method,
    headers,
    // Only propagate body for methods that allow one.
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
  };
  return fetch(targetUrl, init);
}
