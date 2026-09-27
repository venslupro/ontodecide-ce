/**
 * @fileoverview usage_counter (day, key, value) with atomic capped takes
 * (详细设计 6.3.5): INSERT … ON CONFLICT DO NOTHING, then a conditional
 * UPDATE; granted only when changes = 1, so concurrent callers never
 * overshoot the cap.
 */

import {SystemRepository} from '@ontodecide/shared-kernel/d1';
import type {UsageCounter} from '../application';

/** D1 usage counters. */
export class D1UsageCounter extends SystemRepository implements UsageCounter {
  async tryTake(
    day: string,
    key: string,
    n: number,
    cap: number,
  ): Promise<boolean> {
    const [, take] = await this.db.batch([
      this.sql(
        'INSERT INTO usage_counter (day, key, value) VALUES (?1, ?2, 0) ON CONFLICT DO NOTHING',
        day,
        key,
      ),
      this.sql(
        `UPDATE usage_counter SET value = value + ?3
         WHERE day = ?1 AND key = ?2 AND value + ?3 <= ?4`,
        day,
        key,
        n,
        cap,
      ),
    ]);
    return take.meta.changes === 1;
  }

  async adjust(day: string, key: string, delta: number): Promise<void> {
    await this.sql(
      'UPDATE usage_counter SET value = MAX(0, value + ?3) WHERE day = ?1 AND key = ?2',
      day,
      key,
      delta,
    ).run();
  }

  async read(day: string, key: string): Promise<number> {
    const r = await this.sql(
      'SELECT value FROM usage_counter WHERE day = ?1 AND key = ?2',
      day,
      key,
    ).first<{value: number}>();
    return r?.value ?? 0;
  }

  async set(day: string, key: string, value: number): Promise<void> {
    await this.sql(
      `INSERT INTO usage_counter (day, key, value) VALUES (?1, ?2, ?3)
       ON CONFLICT (day, key) DO UPDATE SET value = excluded.value`,
      day,
      key,
      value,
    ).run();
  }

  async sweep(beforeDay: string): Promise<void> {
    await this.sql('DELETE FROM usage_counter WHERE day < ?1', beforeDay).run();
  }
}
