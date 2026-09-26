/**
 * @fileoverview EdgeGuard Durable Object (one instance per tenant via
 * `idFromName(tenantId)`). Delegates to {@link EdgeGuardCore} and schedules
 * its 24 h cleanup with an alarm.
 */

import {DurableObject} from 'cloudflare:workers';
import {
  EdgeGuardCore,
  type IdempotentRecord,
  type SqlStorageLike,
} from './edge_guard_core';
import type {Env} from './env';
import type {TakeResult} from './rate_limiter';

const CLEANUP_INTERVAL_MS = 3_600_000;

/** Per-tenant idempotency store and precise rate counter. */
export class EdgeGuard extends DurableObject<Env> {
  private readonly core: EdgeGuardCore;
  private alarmChecked = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new EdgeGuardCore(ctx.storage.sql as unknown as SqlStorageLike);
  }

  async getIdempotent(key: string): Promise<IdempotentRecord | null> {
    return this.core.getIdempotent(key);
  }

  async putIdempotent(
    key: string,
    status: number,
    body: string,
  ): Promise<void> {
    this.core.putIdempotent(key, status, body);
    await this.ensureAlarm();
  }

  async take(
    bucket: string,
    capacity: number,
    refillPerSec: number,
    now?: number,
  ): Promise<TakeResult> {
    const result = this.core.take(bucket, capacity, refillPerSec, now);
    await this.ensureAlarm();
    return result;
  }

  override async alarm(): Promise<void> {
    this.core.cleanup(Date.now());
    await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
  }

  private async ensureAlarm(): Promise<void> {
    if (this.alarmChecked) return;
    this.alarmChecked = true;
    const current = await this.ctx.storage.getAlarm();
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
    }
  }
}
