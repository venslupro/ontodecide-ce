/**
 * @fileoverview UsageGuard logic (single Durable Object named `global`):
 * accumulates free-tier usage per UTC day and resource. On day rollover the
 * previous days are persisted (to D1 sit_usage_day) through a callback.
 */

import {
  type Clock,
  type Logger,
  type UsageResource,
  type UsageStatus,
  silentLogger,
  systemClock,
  utcDay,
} from '@ontodecide/shared-kernel';
import type {UsageGuardApi} from '../application';
import {
  type UsageThresholds,
  computeUsageStatus,
  isUsageResource,
  usageThresholds,
} from '../domain';
import type {SqlStorageLike} from './sql_storage';

/** Persists a finished day. */
export type UsageRolloverSink = (
  day: string,
  used: Partial<Record<UsageResource, number>>,
) => Promise<void>;

/** Options of {@link UsageGuardCore}. */
export interface UsageGuardOptions {
  clock?: Clock;
  thresholds?: UsageThresholds;
  onRollover?: UsageRolloverSink;
  logger?: Logger;
}

/** UsageGuard state over DO SQLite. */
export class UsageGuardCore implements UsageGuardApi {
  private readonly clock: Clock;
  private readonly thresholds: UsageThresholds;
  private readonly logger: Logger;

  constructor(
    private readonly sql: SqlStorageLike,
    private readonly opts: UsageGuardOptions = {},
  ) {
    this.clock = opts.clock ?? systemClock;
    this.thresholds = opts.thresholds ?? usageThresholds();
    this.logger = opts.logger ?? silentLogger;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS usage (
         day TEXT NOT NULL, resource TEXT NOT NULL, used REAL NOT NULL,
         PRIMARY KEY (day, resource))`,
    );
  }

  async record(
    batch: {resource: UsageResource; n: number}[],
  ): Promise<UsageStatus> {
    const today = utcDay(this.clock.now());
    await this.rollover(today);
    for (const {resource, n} of batch ?? []) {
      if (!isUsageResource(resource) || !Number.isFinite(n) || n <= 0) continue;
      this.sql.exec(
        `INSERT INTO usage (day, resource, used) VALUES (?, ?, ?)
         ON CONFLICT (day, resource) DO UPDATE SET used = used + excluded.used`,
        today,
        resource,
        n,
      );
    }
    return this.statusOf(today);
  }

  async status(): Promise<UsageStatus> {
    const today = utcDay(this.clock.now());
    await this.rollover(today);
    return this.statusOf(today);
  }

  private statusOf(day: string): UsageStatus {
    return computeUsageStatus(day, this.usedOn(day), this.thresholds);
  }

  private usedOn(day: string): Partial<Record<UsageResource, number>> {
    const used: Partial<Record<UsageResource, number>> = {};
    for (const r of this.sql
      .exec<{resource: string; used: number}>(
        'SELECT resource, used FROM usage WHERE day = ?',
        day,
      )
      .toArray()) {
      if (isUsageResource(r.resource)) used[r.resource] = Number(r.used);
    }
    return used;
  }

  /** Persists and drops days before `today`; kept on sink failure. */
  private async rollover(today: string): Promise<void> {
    const days = this.sql
      .exec<{day: string}>(
        'SELECT DISTINCT day FROM usage WHERE day < ? ORDER BY day',
        today,
      )
      .toArray()
      .map(r => r.day);
    for (const day of days) {
      try {
        await this.opts.onRollover?.(day, this.usedOn(day));
        this.sql.exec('DELETE FROM usage WHERE day = ?', day);
      } catch (e) {
        this.logger.warn('usage rollover failed', {
          day,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
}
