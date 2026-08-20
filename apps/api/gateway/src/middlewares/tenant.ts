/**
 * Tenant middleware: copies identity claims into downstream headers.
 *
 * Downstream services trust `x-tenant-id` etc. only when the request carries
 * the internal-call marker (set here). The Gateway is the single source of
 * truth for these headers — workers are deployed in the same account, so a
 * request without the marker but with these headers is rejected.
 */
import {HEADERS} from '@ontodecide/shared';
import type {AuthContext} from './auth.js';

/**
 * Build a new `Headers` object that includes the original request headers
 * plus the identity headers injected by the Gateway.
 */
export function withIdentityHeaders(
    original: Headers,
    auth: AuthContext,
): Headers {
  const headers = new Headers(original);
  headers.set(HEADERS.TENANT_ID, auth.payload.tenant_id);
  headers.set(HEADERS.USER_ID, auth.payload.user_id);
  headers.set(HEADERS.USER_ROLE, auth.payload.role);
  headers.set(HEADERS.TRACE_ID, auth.traceId);
  headers.set(HEADERS.INTERNAL, '1');
  // Strip the Authorization header so downstream services cannot reuse it
  // for cross-service calls.
  headers.delete(HEADERS.AUTHORIZATION);
  return headers;
}
