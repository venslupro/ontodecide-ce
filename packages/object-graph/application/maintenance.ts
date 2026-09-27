/**
 * @fileoverview Cron maintenance (*\/15 * * * *): redeliver the oldest
 * undelivered outbox rows, deleting each once sent (rows of purged
 * workspaces are dropped), then sweep tombstones older than 48 hours.
 */

import {AppError, MINUTE_MS} from '@ontodecide/shared-kernel';
import type {Clock, Logger} from '@ontodecide/shared-kernel';
import type {EventPublisher, OutboxRelayStore} from './ports';

/** Rows redelivered per cron run. */
export const REDELIVERY_BATCH = 50;

/** Rows younger than this are left to their own request's delivery. */
export const REDELIVERY_MIN_AGE_MS = MINUTE_MS;

/** Outcome of one maintenance run. */
export interface MaintenanceReport {
  delivered: number;
  dropped: number;
  failed: number;
}

/** Runs one maintenance pass. */
export async function runMaintenance(deps: {
  store: OutboxRelayStore;
  publisher: EventPublisher;
  clock: Clock;
  logger: Logger;
}): Promise<MaintenanceReport> {
  const nowMs = deps.clock.now().getTime();
  const report: MaintenanceReport = {delivered: 0, dropped: 0, failed: 0};
  const rows = await deps.store.oldest(
    nowMs - REDELIVERY_MIN_AGE_MS,
    REDELIVERY_BATCH,
  );
  const tombstoned = new Map<string, boolean>();
  for (const row of rows) {
    if (!tombstoned.has(row.tid)) {
      tombstoned.set(row.tid, await deps.store.isTombstoned(row.tid));
    }
    if (tombstoned.get(row.tid)) {
      await deps.store.delete(row.tid, row.id);
      report.dropped++;
      continue;
    }
    try {
      await deps.publisher.publish(row.msg);
    } catch (e) {
      report.failed++;
      deps.logger.warn('outbox.redelivery_failed', {
        tid: row.tid,
        eventId: row.id,
        error: AppError.from(e).code,
      });
      continue;
    }
    await deps.store.delete(row.tid, row.id);
    report.delivered++;
  }
  await deps.store.sweepTombstones(nowMs);
  if (rows.length) deps.logger.info('outbox.redelivery', {...report});
  return report;
}
