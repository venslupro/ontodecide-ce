/**
 * Request-forwarding helper — Cloudflare **Service Bindings** edition.
 *
 * Builds the downstream `Request` from the inbound request and the injected
 * identity headers, then invokes the target Worker via its Service Binding
 * `Fetcher`. Service Bindings provide:
 *   • Zero-cost, in-account routing — no public DNS, no external-request
 *     billing, no workers.dev cold-start hop.
 *   • Implicit trust between the Gateway and downstream services (the
 *     `x-internal-call: 1` header still acts as a belt-and-suspenders
 *     check so services also reject direct caller spoofing).
 *
 * The response is returned verbatim (status + body), so the Gateway behaves
 * as a transparent proxy with auth/ratelimit sidecars.
 */
import { withIdentityHeaders } from './middlewares/tenant.js';
import type { AuthContext } from './middlewares/auth.js';

/** Dummy origin used for Service Binding calls (host is ignored by the
 *  platform; only the path + querystring are routed to the bound Worker). */
const INTERNAL_ORIGIN = 'https://internal';

/** Build the downstream path: strip `/api` prefix, keep querystring. */
export function buildDownstreamPath(originalUrl: string): string {
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
  return `${path}${parsed.search}`;
}

/** Forward the inbound request to the downstream Service Binding. */
export async function forwardRequest(
  request: Request,
  binding: Fetcher,
  auth: AuthContext,
): Promise<Response> {
  const headers = withIdentityHeaders(request.headers, auth);
  const path = buildDownstreamPath(request.url);
  const init: RequestInit = {
    method: request.method,
    headers,
    // Only propagate body for methods that allow one.
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
  };
  // Service Binding `Fetcher.fetch` ignores the host portion of the URL;
  // only the path + querystring are delivered to the bound Worker.
  return binding.fetch(`${INTERNAL_ORIGIN}${path}`, init);
}
