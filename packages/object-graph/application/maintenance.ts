/**
 * @fileoverview Background use cases: cron maintenance (outbox re-dispatch,
 * writeback retries, purges, daily Neo4j heartbeat) and the graph-sync
 * consumer.
 */

import {DAY_MS, MINUTE_MS, systemCtx, utcDay} from '@ontodecide/shared-kernel';
import type {GraphSyncMsg} from '../contract';
import {writebackBody} from './apply_action';
import type {AppDeps} from './ports';

/** Writeback attempts before a pending writeback is left alone. */
export const WRITEBACK_MAX_ATTEMPTS = 3;
/** Tenant id used for system-wide metadata rows. */
export const SYSTEM_TENANT = '_system';
/** og_meta key of the last heartbeat day. */
export const META_HEARTBEAT_DAY = 'neo4jHeartbeatDay';

/** Summary of one maintenance run. */
export interface MaintenanceReport {
  redispatched: number;
  writebacksRetried: number;
  writebacksSent: number;
  purged: number;
  heartbeat: boolean;
}

/** Use case: the `*\/15 * * * *` cron run. */
export class RunMaintenance {
  constructor(private readonly d: AppDeps) {}

  async handle(now: Date): Promise<MaintenanceReport> {
    const t = now.getTime();
    const report: MaintenanceReport = {
      redispatched: 0,
      writebacksRetried: 0,
      writebacksSent: 0,
      purged: 0,
      heartbeat: false,
    };
    report.redispatched = await this.d.outbox.redispatchPending(
      t - MINUTE_MS,
      now,
      500,
    );
    await this.retryWritebacks(report);
    report.purged = await this.d.outbox.purgeDispatched(t - 7 * DAY_MS);
    await this.d.meta.purgeInbox(t - 7 * DAY_MS);
    if (this.d.projection.enabled) {
      const day = utcDay(now);
      const last = await this.d.meta.get(SYSTEM_TENANT, META_HEARTBEAT_DAY);
      if (last !== day) {
        try {
          await this.d.projection.heartbeat(now);
          await this.d.meta.set(SYSTEM_TENANT, META_HEARTBEAT_DAY, day);
          report.heartbeat = true;
        } catch (e) {
          this.d.logger.warn('neo4j heartbeat failed', {error: String(e)});
        }
      }
    }
    return report;
  }

  private async retryWritebacks(report: MaintenanceReport): Promise<void> {
    const pending = await this.d.actionLogs.pendingWritebacks(
      WRITEBACK_MAX_ATTEMPTS,
      50,
    );
    for (const log of pending) {
      const attempts = log.writebackAttempts + 1;
      const model = await this.d.models.get(systemCtx(log.tenantId, 'cron'));
      const wb = model.actionTypes[log.actionType]?.writeback;
      if (wb?.kind !== 'webhook') {
        await this.d.actionLogs.setWriteback(
          log.tenantId,
          log.id,
          'WRITEBACK_PENDING',
          WRITEBACK_MAX_ATTEMPTS,
        );
        continue;
      }
      report.writebacksRetried++;
      try {
        await this.d.writeback.send({
          url: wb.url,
          body: writebackBody(log),
          idempotencyKey: log.id,
        });
        await this.d.actionLogs.setWriteback(
          log.tenantId,
          log.id,
          'SENT',
          attempts,
        );
        report.writebacksSent++;
      } catch (e) {
        await this.d.actionLogs.setWriteback(
          log.tenantId,
          log.id,
          'WRITEBACK_PENDING',
          attempts,
        );
        this.d.logger.warn('writeback retry failed', {
          actionLogId: log.id,
          attempts,
          error: String(e),
        });
      }
    }
  }
}

/** Use case: apply one graph-sync message to the projection (or no-op). */
export class SyncGraph {
  constructor(private readonly d: AppDeps) {}

  async handle(msg: GraphSyncMsg): Promise<void> {
    if (!this.d.projection.enabled) return;
    await this.d.projection.sync(msg);
  }
}
