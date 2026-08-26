/**
 * Two-tier rate limiter backed by a KV counter.
 *
 * Tier 1 — authenticated traffic (user_id from JWT): 20 req/min per user.
 *          KV key prefix: rlu:{userId}:{windowStart}
 * Tier 2 — public/anonymous traffic (login/refresh): 5 req/min per IP.
 *          KV key prefix: rli:{ip}:{windowStart}
 */
import type { MiddlewareHandler } from 'hono';
import { ERROR_CODES, jsonResponse, fail } from '@ontodecide/shared';
import type { GatewayEnv } from '../types/env.js';
import type { GatewayVariables } from './auth.js';

const WINDOW_SECONDS = 60;

/** Authenticated users: 20 req/min. */
export const USER_LIMIT = 20;

/** Public/login endpoints: 5 req/min per client IP (anti-bruteforce). */
export const PUBLIC_IP_LIMIT = 5;

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
 * Core counter primitive — increments a namespaced KV counter and returns
 * the windowed evaluation result. Uses `expirationTtl` so counters
 * auto-evict right after their window rolls over.
 */
async function incrementCounter(
  kv: KVNamespace,
  prefix: string,
  discriminator: string,
  limit: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % WINDOW_SECONDS);
  const key = `${prefix}:${discriminator}:${windowStart}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) {
    return { allowed: false, count, limit, resetIn: WINDOW_SECONDS - (now - windowStart) };
  }
  await kv.put(key, String(count + 1), { expirationTtl: WINDOW_SECONDS + 5 });
  return { allowed: true, count: count + 1, limit, resetIn: WINDOW_SECONDS - (now - windowStart) };
}

/** Tier 1: JWT-authenticated user bucketed by user_id. */
export async function rateLimitByUser(
  kv: KVNamespace,
  userId: string,
  limit: number = USER_LIMIT,
): Promise<RateLimitResult> {
  return incrementCounter(kv, 'rlu', userId, limit);
}

/** Tier 2: anonymous/login traffic bucketed by client IP (passed as-is). */
export async function rateLimitByIp(
  kv: KVNamespace,
  ip: string,
  limit: number = PUBLIC_IP_LIMIT,
): Promise<RateLimitResult> {
  // If caller can't determine an IP, fall back to a shared "anon" bucket
  // so unknown proxies still get a (conservative) global cap.
  const safeIp = ip && ip.length > 0 ? ip : 'anon';
  return incrementCounter(kv, 'rli', safeIp, limit);
}

/** Reject helper that returns a 429 envelope with standard headers. */
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
 * Hono middleware that routes each request to the correct tier:
 *   - user_id !== 'anon' → Tier 1 per-user limit (20 req/min).
 *   - user_id === 'anon' (public routes) → Tier 2 per-IP limit (5 req/min).
 */
export const rateLimitMiddleware: MiddlewareHandler<{
  Bindings: GatewayEnv;
  Variables: GatewayVariables;
}> = async (c, next) => {
  const auth = c.get('auth');
  const userId = auth.payload.user_id ?? 'anon';

  let rl: RateLimitResult;
  if (userId !== 'anon') {
    rl = await rateLimitByUser(c.env.RATE_LIMIT, userId, USER_LIMIT);
  } else {
    const ip = c.req.header('cf-connecting-ip') ?? '';
    rl = await rateLimitByIp(c.env.RATE_LIMIT, ip, PUBLIC_IP_LIMIT);
  }
  if (!rl.allowed) {
    return rateLimitResponse(rl, auth.traceId);
  }
  return next();
};
