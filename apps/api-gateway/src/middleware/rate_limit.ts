/**
 * @fileoverview Rate limiting: isolate-memory token buckets per
 * tenant + rate group (auth: per client IP, webhook: per source); write
 * routes are additionally counted precisely in the tenant's EdgeGuard.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {BucketSpec} from '../rate_limiter';
import {isWrite, rateGroupOf, type RateGroup} from '../route_types';
import {
  type GatewayDeps,
  type GatewayState,
  type Middleware,
  routeOf,
} from './chain';

/** Bucket parameters per group. */
export const RATE_SPECS: Record<RateGroup, BucketSpec> = {
  read: {capacity: 60, refillPerSec: 1},
  write: {capacity: 60, refillPerSec: 1},
  ingest: {capacity: 60, refillPerSec: 1},
  ai: {capacity: 60, refillPerSec: 1},
  // Slows password guessing: burst 10, then 1 attempt / 5 s per IP.
  auth: {capacity: 10, refillPerSec: 0.2},
  // 60 / minute per source.
  webhook: {capacity: 60, refillPerSec: 1},
};

/** Memory bucket key for a request. */
export function bucketKey(s: GatewayState, group: RateGroup): string {
  if (group === 'auth') return `ip:${s.ip}:auth`;
  if (group === 'webhook') return `src:${s.params.sourceId ?? ''}:webhook`;
  const owner = s.ctx?.tenantId ? `t:${s.ctx.tenantId}` : `ip:${s.ip}`;
  return `${owner}:${group}`;
}

function limited(retryAfterSec: number): AppError {
  return new AppError('RATE_LIMITED', 'Too many requests', {
    retryAfter: retryAfterSec,
  });
}

/** Rate limit step. */
export function rateLimit(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    const route = routeOf(s);
    const group = rateGroupOf(route);
    const spec = RATE_SPECS[group];
    const now = deps.now();
    const local = deps.limiter.take(bucketKey(s, group), spec, now);
    if (!local.ok) throw limited(local.retryAfterSec);

    const tenantId = s.ctx?.tenantId;
    if (tenantId && isWrite(route)) {
      let precise;
      try {
        const flush = deps.meter.record('do.requests', 1);
        if (flush) s.waitUntil(flush);
        precise = await deps
          .edgeGuard(tenantId)
          .take(`${tenantId}:${group}`, spec.capacity, spec.refillPerSec, now);
      } catch (err) {
        // Fail open: EdgeGuard trouble must not block writes.
        deps.logger.warn('edge_guard.take_failed', {
          requestId: s.requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (precise && !precise.ok) throw limited(precise.retryAfterSec);
    }
    return next();
  };
}
