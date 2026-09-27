/**
 * @fileoverview dec_usage capped counters (详细设计 6.3.5).
 *
 * Scope scheme: `rec_ai` rows use scope `{tid}:{sub}` (per-user daily cap,
 * purgeable by the workspace prefix); `neurons` uses scope `*` (the
 * service-wide daily budget, never purged).
 */

import {
  adjustCounter,
  readCounter,
  tryTake,
} from '@ontodecide/shared-kernel/d1';
import type {UsageCounter, UsageKey} from '../application';

const TABLE = 'dec_usage';

/** D1 implementation of {@link UsageCounter}. */
export class D1UsageCounter implements UsageCounter {
  constructor(private readonly db: D1Database) {}

  tryTake(
    day: string,
    scope: string,
    key: UsageKey,
    n: number,
    cap: number,
  ): Promise<boolean> {
    return tryTake(this.db, {table: TABLE, day, scope, key}, n, cap);
  }

  adjust(
    day: string,
    scope: string,
    key: UsageKey,
    delta: number,
  ): Promise<void> {
    return adjustCounter(this.db, {table: TABLE, day, scope, key}, delta);
  }

  read(day: string, scope: string, key: UsageKey): Promise<number> {
    return readCounter(this.db, {table: TABLE, day, scope, key});
  }
}
