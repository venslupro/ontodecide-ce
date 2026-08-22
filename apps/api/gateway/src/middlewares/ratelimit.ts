/**
 * Simple per-tenant rate limiter backed by a KV counter.
 *
 * Strategy: each request increments a counter keyed by `rl:{tenantId}:{minute}`.
 * If the counter exceeds the limit, the request is rejected with `429`.
 *
 * The free-tier limit is 100k Worker requests/day, so a per-tenant limit of
 * 600 req/min is generous and leaves headroom for downstream service calls.
 */
import type { MiddlewareHandler } from 'hono';
import { ERROR_CODES, jsonResponse, fail } from '@ontodecide/shared';
import type { GatewayEnv } from '../types/env.js';
import type { GatewayVariables } from './auth.js';

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 600;

export interface RateLimitResult {
  allowed: boolean;
  /** Current count for this window. */
  count: number;
  /** Configured limit. */
  limit: number;
  /** Seconds until the window resets. */
  resetIn: number;
}

/**
 * Evaluate the rate limit for the given tenant.
 *
 * Uses `expirationTtl` so the counter auto-evicts after the window, which
 * keeps KV key counts low.
 */
export async function rateLimit(
  kv: KVNamespace,
  tenantId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % WINDOW_SECONDS);
  const key = `rl:${tenantId}:${windowStart}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) {
    return { allowed: false, count, limit, resetIn: WINDOW_SECONDS - (now - windowStart) };
  }
  // Best-effort increment: KV is eventually consistent, so a few over-limit
  // calls are acceptable under the free plan.
  await kv.put(key, String(count + 1), { expirationTtl: WINDOW_SECONDS + 5 });
  return { allowed: true, count: count + 1, limit, resetIn: WINDOW_SECONDS - (now - windowStart) };
}

/** Reject helper that returns a 429 envelope. */
export function rateLimitResponse(result: RateLimitResult, traceId?: string): Response {
  return jsonResponse(
    fail(
      ERROR_CODES.AUTH_RATE_LIMITED,
      `Rate limit exceeded. Try again in ${result.resetIn}s.`,
      undefined,
      traceId,
    ),
    429,
    {
      'Retry-After': String(result.resetIn),
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': '0',
    },
  );
}

/**
 * Hono middleware that enforces per-tenant rate limits.
 *
 * Reads the tenant id from `c.var.auth` (set by `authMiddleware`) and
 * rejects the request with `429` when the limit is exceeded.
 */
export const rateLimitMiddleware: MiddlewareHandler<{
  Bindings: GatewayEnv;
  Variables: GatewayVariables;
}> = async (c, next) => {
  const auth = c.get('auth');
  const tenantKey = auth.payload.tenant_id ?? 'anon';
  const rl = await rateLimit(c.env.RATE_LIMIT, tenantKey);
  if (!rl.allowed) {
    return rateLimitResponse(rl, auth.traceId);
  }
  await next();
  return;
};
