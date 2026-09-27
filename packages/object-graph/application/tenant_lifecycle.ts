/**
 * @fileoverview TenantLifecycle use cases (详细设计 6.11.3, 修订说明书 9):
 * cursor-paged export of objects.jsonl, links.jsonl and audit.jsonl
 * (≤ 2,000 rows and ≤ 900 KB per page), purge in the order og_prop_index →
 * og_link → og_object → og_action_log → domain_event with a local tombstone
 * when done, row counts, and object/link counts of several workspaces for
 * the platform admin list.
 */

import {
  AppError,
  LIFECYCLE,
  decodeCursor,
  encodeCursor,
} from '@ontodecide/shared-kernel';
import type {
  Clock,
  ExportPage,
  PurgeResult,
  TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import type {GraphExportFile, LifecycleStore} from './ports';

/** Files exported by object-graph, in order. */
export const GRAPH_EXPORT_FILES: readonly GraphExportFile[] = [
  'objects.jsonl',
  'links.jsonl',
  'audit.jsonl',
];

/** Workspaces per tenantStats call (one admin list page). */
export const TENANT_STATS_MAX = 100;

interface ExportCursor {
  f: number;
  k: string[] | null;
}

const ENCODER = new TextEncoder();

function parseCursor(cursor: string | null): ExportCursor {
  if (!cursor) return {f: 0, k: null};
  const c = decodeCursor<ExportCursor>(cursor);
  if (
    !c ||
    !Number.isInteger(c.f) ||
    c.f < 0 ||
    c.f >= GRAPH_EXPORT_FILES.length ||
    (c.k !== null && !Array.isArray(c.k))
  ) {
    throw new AppError('VALIDATION_FAILED', 'Invalid export cursor');
  }
  return c;
}

/** Builds the TenantLifecycle implementation over a store. */
export function createTenantLifecycle(deps: {
  store: LifecycleStore;
  clock: Clock;
  pageRows?: number;
  pageBytes?: number;
}): TenantLifecycleRpc {
  const pageRows = deps.pageRows ?? LIFECYCLE.exportPageRows;
  const pageBytes = deps.pageBytes ?? LIFECYCLE.exportPageBytes;
  return {
    async exportTenant(tid, cursor): Promise<ExportPage> {
      requireTid(tid);
      let {f, k} = parseCursor(cursor);
      for (;;) {
        const file = GRAPH_EXPORT_FILES[f];
        const rows = await deps.store.exportRows(tid, file, k, pageRows);
        let text = '';
        let bytes = 0;
        let last = k;
        let n = 0;
        for (const r of rows) {
          const line = JSON.stringify(r.record) + '\n';
          const size = ENCODER.encode(line).length;
          if (n > 0 && bytes + size > pageBytes) break;
          text += line;
          bytes += size;
          last = r.key;
          n++;
        }
        const fileDone = n === rows.length && rows.length < pageRows;
        if (!fileDone) {
          return {file, text, nextCursor: encodeCursor({f, k: last})};
        }
        const next = f + 1;
        if (next >= GRAPH_EXPORT_FILES.length) {
          return {file, text, nextCursor: null};
        }
        if (n > 0) {
          return {file, text, nextCursor: encodeCursor({f: next, k: null})};
        }
        f = next;
        k = null;
      }
    },

    async purgeTenant(tid, maxRows): Promise<PurgeResult> {
      requireTid(tid);
      const n = Math.max(
        1,
        Math.min(LIFECYCLE.purgeBatchRows, Math.floor(maxRows) || 1),
      );
      const step = await deps.store.purgeStep(tid, n);
      if (!step.remaining) {
        await deps.store.writeTombstone(tid, deps.clock.now().getTime());
      }
      return {deleted: step.deleted, done: !step.remaining};
    },

    countTenant(tid): Promise<number> {
      requireTid(tid);
      return deps.store.count(tid);
    },

    async tenantStats(
      tids,
    ): Promise<Record<string, {objects: number; links: number}>> {
      if (!Array.isArray(tids) || tids.length > TENANT_STATS_MAX) {
        throw new AppError(
          'VALIDATION_FAILED',
          `At most ${TENANT_STATS_MAX} tenant ids per call`,
        );
      }
      tids.forEach(requireTid);
      const unique = [...new Set(tids)];
      const found = await deps.store.stats(unique);
      return Object.fromEntries(
        unique.map(t => [t, found[t] ?? {objects: 0, links: 0}]),
      );
    },
  };
}

function requireTid(tid: string): void {
  if (typeof tid !== 'string' || !tid) {
    throw new AppError('VALIDATION_FAILED', 'tenantId is required');
  }
}
