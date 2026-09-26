/**
 * @fileoverview Quota guard: at `stop` level non-critical writes are
 * rejected with 503 QUOTA_EXCEEDED; reads and critical writes (approvals,
 * auth) pass. Status is cached for 30 s; SITUATION outages fail open.
 */

import {
  AppError,
  systemCtx,
  type CallCtx,
  type UsageStatus,
} from '@ontodecide/shared-kernel';
import type {Env} from '../env';
import {isWrite} from '../route_types';
import {type GatewayDeps, type Middleware, routeOf} from './chain';

const CACHE_MS = 30_000;

/** Cached UsageGuard status. */
export class UsageGuardCache {
  private cached: {at: number; status: UsageStatus | undefined} | undefined;

  constructor(
    private readonly env: Env,
    private readonly now: () => number,
    private readonly ttlMs = CACHE_MS,
  ) {}

  /** Stores a fresh status (e.g. returned by recordUsage). */
  set(status: UsageStatus): void {
    this.cached = {at: this.now(), status};
  }

  /** Returns the status, or undefined when unknown (fail open). */
  async get(ctx: CallCtx): Promise<UsageStatus | undefined> {
    if (this.cached && this.now() - this.cached.at < this.ttlMs) {
      return this.cached.status;
    }
    let status: UsageStatus | undefined;
    try {
      status = await this.env.SITUATION.getUsage(ctx);
    } catch {
      status = undefined;
    }
    this.cached = {at: this.now(), status};
    return status;
  }
}

/** Usage guard step. */
export function usageGuard(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    const route = routeOf(s);
    if (!isWrite(route) || route.critical) return next();
    const ctx = s.ctx?.tenantId
      ? s.ctx
      : systemCtx('_gateway', s.correlationId);
    const status = await deps.usage.get(ctx);
    if (status?.level === 'stop') {
      throw new AppError(
        'QUOTA_EXCEEDED',
        'Daily free-tier quota nearly exhausted; non-critical writes are paused',
      );
    }
    return next();
  };
}
