/**
 * @fileoverview int_usage capped counters (详细设计 6.3.5) over the shared
 * kernel's atomic `tryTake` / `adjustCounter` / `readCounter`.
 */

import {
  adjustCounter,
  readCounter,
  tryTake,
} from '@ontodecide/shared-kernel/d1';
import type {CounterKey} from '@ontodecide/shared-kernel/d1';
import type {UsageRef, UsageRepository} from '../application';

const TABLE = 'int_usage';

function key(ref: UsageRef): CounterKey {
  return {table: TABLE, day: ref.day, scope: ref.scope, key: ref.key};
}

/** {@link UsageRepository} over D1. */
export class D1UsageRepository implements UsageRepository {
  constructor(private readonly db: D1Database) {}

  take(ref: UsageRef, n: number, cap: number): Promise<boolean> {
    return tryTake(this.db, key(ref), n, cap);
  }

  adjust(ref: UsageRef, delta: number): Promise<void> {
    return adjustCounter(this.db, key(ref), delta);
  }

  read(ref: UsageRef): Promise<number> {
    return readCounter(this.db, key(ref));
  }
}
