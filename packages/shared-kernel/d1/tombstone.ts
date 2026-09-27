/**
 * @fileoverview Local tenant tombstones (详细设计 6.4.2). Each D1-owning
 * service writes one when its purgeTenant completes and drops late requests
 * and messages for that workspace; tombstones are removed after 48 hours.
 */

import {LIFECYCLE} from '../limits';

/** Statement writing a tombstone (idempotent). */
export function writeTombstone(db: D1Database, tid: string, nowMs: number) {
  return db
    .prepare(
      `INSERT INTO tenant_tombstone (tenant_id, deleted_at) VALUES (?1, ?2)
       ON CONFLICT (tenant_id) DO NOTHING`,
    )
    .bind(tid, nowMs);
}

/** Whether the workspace has been purged from this service. */
export async function hasTombstone(
  db: D1Database,
  tid: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM tenant_tombstone WHERE tenant_id = ?1')
    .bind(tid)
    .first();
  return row !== null;
}

/** Deletes tombstones older than 48 hours. */
export async function sweepTombstones(
  db: D1Database,
  nowMs: number,
): Promise<void> {
  await db
    .prepare('DELETE FROM tenant_tombstone WHERE deleted_at < ?1')
    .bind(nowMs - LIFECYCLE.tombstoneHours * 3_600_000)
    .run();
}
