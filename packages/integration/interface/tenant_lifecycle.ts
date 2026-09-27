/**
 * @fileoverview TenantLifecycle of data-integration (详细设计 6.11.2):
 * exports `imports.json` (jobs and mapping definitions, never raw data),
 * purges int_reject, int_batch, int_job, int_mapping and the workspace's
 * int_usage rows in bounded steps, then writes the local tombstone.
 */

import {LIFECYCLE} from '@ontodecide/shared-kernel';
import type {
  Clock,
  ExportPage,
  PurgeResult,
  TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import {D1LifecycleRepository, PURGE_TABLES} from '../infrastructure';

/** Builds the TenantLifecycle implementation. */
export function createIntegrationLifecycle(
  db: D1Database,
  clock: Clock,
): TenantLifecycleRpc {
  const repo = new D1LifecycleRepository(db);
  return {
    async exportTenant(tid: string): Promise<ExportPage> {
      const [jobs, mappings] = await Promise.all([
        repo.exportJobs(tid),
        repo.exportMappings(tid),
      ]);
      return {
        file: 'imports.json',
        text: JSON.stringify({jobs, mappings}),
        nextCursor: null,
      };
    },

    async purgeTenant(tid: string, maxRows: number): Promise<PurgeResult> {
      let budget = Math.max(
        1,
        Math.min(Math.floor(maxRows) || 1, LIFECYCLE.purgeBatchRows),
      );
      let deleted = 0;
      for (const t of PURGE_TABLES) {
        // Fewer rows than requested means the table is now empty.
        const n = await repo.purgeTable(t, tid, budget);
        deleted += n;
        budget -= n;
        if (budget === 0) break;
      }
      if (budget > 0) {
        await repo.tombstone(tid, clock.now().getTime());
        return {deleted, done: true};
      }
      let left = 0;
      for (const t of PURGE_TABLES) left += await repo.countTable(t, tid);
      if (left === 0) await repo.tombstone(tid, clock.now().getTime());
      return {deleted, done: left === 0};
    },

    async countTenant(tid: string): Promise<number> {
      let n = 0;
      for (const t of PURGE_TABLES) n += await repo.countTable(t, tid);
      return n;
    },
  };
}
