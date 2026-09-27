/**
 * @fileoverview Atomic capped counters for scarce actions (详细设计 6.3.5).
 *
 * Usage tables share the shape `(day, scope, key, value)` with primary key
 * `(day, scope, key)`. A take is an INSERT … ON CONFLICT DO NOTHING followed
 * by a conditional UPDATE; it succeeds only when `changes = 1`, so
 * concurrent callers never overshoot the cap.
 */

/** A capped counter row. */
export interface CounterKey {
  /** Table name, e.g. `dec_usage`. */
  table: string;
  day: string;
  /** tenant id, or `*` for service-wide budgets. */
  scope: string;
  key: string;
}

const SAFE_TABLE = /^[a-z_]+$/;

function table(k: CounterKey): string {
  if (!SAFE_TABLE.test(k.table)) throw new Error(`bad table ${k.table}`);
  return k.table;
}

/** Statement that ensures the counter row exists. */
export function ensureCounter(db: D1Database, k: CounterKey) {
  return db
    .prepare(
      `INSERT INTO ${table(k)} (day, scope, key, value) VALUES (?1, ?2, ?3, 0)
       ON CONFLICT DO NOTHING`,
    )
    .bind(k.day, k.scope, k.key);
}

/** Statement that adds `n` when the result stays ≤ cap. */
export function takeCounter(
  db: D1Database,
  k: CounterKey,
  n: number,
  cap: number,
) {
  return db
    .prepare(
      `UPDATE ${table(k)} SET value = value + ?4
       WHERE day = ?1 AND scope = ?2 AND key = ?3 AND value + ?4 <= ?5`,
    )
    .bind(k.day, k.scope, k.key, n, cap);
}

/** Atomically takes `n` units; true when they were granted. */
export async function tryTake(
  db: D1Database,
  k: CounterKey,
  n: number,
  cap: number,
): Promise<boolean> {
  const [, take] = await db.batch([
    ensureCounter(db, k),
    takeCounter(db, k, n, cap),
  ]);
  return take.meta.changes === 1;
}

/** Adjusts a counter by `delta` (settling a reservation); never below 0. */
export async function adjustCounter(
  db: D1Database,
  k: CounterKey,
  delta: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE ${table(k)} SET value = MAX(0, value + ?4)
       WHERE day = ?1 AND scope = ?2 AND key = ?3`,
    )
    .bind(k.day, k.scope, k.key, delta)
    .run();
}

/** Reads a counter (0 when absent). */
export async function readCounter(
  db: D1Database,
  k: CounterKey,
): Promise<number> {
  const v = await db
    .prepare(
      `SELECT value FROM ${table(k)} WHERE day = ?1 AND scope = ?2 AND key = ?3`,
    )
    .bind(k.day, k.scope, k.key)
    .first<number>('value');
  return v ?? 0;
}
