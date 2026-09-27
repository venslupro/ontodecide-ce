/**
 * @fileoverview TenantLifecycle storage (SystemRepository): export of jobs
 * and mappings, bounded purge and row counts of one workspace.
 */

import {parseJson} from '@ontodecide/shared-kernel';
import {SystemRepository, writeTombstone} from '@ontodecide/shared-kernel/d1';
import type {MappingSpec} from '../contract';

/** Tables purged, in order (children first). */
export const PURGE_TABLES = [
  {table: 'int_reject', where: 'tenant_id = ?1'},
  {table: 'int_batch', where: 'tenant_id = ?1'},
  {table: 'int_job', where: 'tenant_id = ?1'},
  {table: 'int_mapping', where: 'tenant_id = ?1'},
  {table: 'int_usage', where: 'scope = ?1'},
] as const;

/** Exported job (no raw data, no rejects). */
export interface ExportedJob {
  id: string;
  kind: string;
  fileName: string | null;
  targetType: string;
  mapping: MappingSpec | null;
  status: string;
  totalRows: number;
  received: number;
  upserted: number;
  skipped: number;
  rejected: number;
  createdAt: string;
  updatedAt: string;
}

/** Exported saved mapping. */
export interface ExportedMapping {
  id: string;
  name: string | null;
  targetType: string;
  spec: MappingSpec | null;
  updatedAt: string;
}

/** Cross-workspace maintenance for one tenant id. */
export class D1LifecycleRepository extends SystemRepository {
  async exportJobs(tid: string): Promise<ExportedJob[]> {
    const {results} = await this.sql(
      `SELECT id, kind, file_name, target_type, mapping, status, total_rows,
              received, upserted, skipped, rejected, created_at, updated_at
       FROM int_job WHERE tenant_id = ?1 ORDER BY id`,
      tid,
    ).all<Record<string, unknown>>();
    return results.map(r => ({
      id: r.id as string,
      kind: r.kind as string,
      fileName: (r.file_name as string | null) ?? null,
      targetType: r.target_type as string,
      mapping: parseJson<MappingSpec | null>(r.mapping as string, null),
      status: r.status as string,
      totalRows: r.total_rows as number,
      received: r.received as number,
      upserted: r.upserted as number,
      skipped: r.skipped as number,
      rejected: r.rejected as number,
      createdAt: new Date(r.created_at as number).toISOString(),
      updatedAt: new Date(r.updated_at as number).toISOString(),
    }));
  }

  async exportMappings(tid: string): Promise<ExportedMapping[]> {
    const {results} = await this.sql(
      `SELECT id, name, target_type, spec, updated_at FROM int_mapping
       WHERE tenant_id = ?1 ORDER BY id`,
      tid,
    ).all<Record<string, unknown>>();
    return results.map(r => ({
      id: r.id as string,
      name: (r.name as string | null) ?? null,
      targetType: r.target_type as string,
      spec: parseJson<MappingSpec | null>(r.spec as string, null),
      updatedAt: new Date(r.updated_at as number).toISOString(),
    }));
  }

  /** Deletes up to `maxRows` rows of one table; returns the count. */
  async purgeTable(
    t: (typeof PURGE_TABLES)[number],
    tid: string,
    maxRows: number,
  ): Promise<number> {
    const res = await this.sql(
      `DELETE FROM ${t.table} WHERE rowid IN
         (SELECT rowid FROM ${t.table} WHERE ${t.where} LIMIT ?2)`,
      tid,
      maxRows,
    ).run();
    return res.meta.changes;
  }

  async countTable(
    t: (typeof PURGE_TABLES)[number],
    tid: string,
  ): Promise<number> {
    const n = await this.sql(
      `SELECT COUNT(*) AS n FROM ${t.table} WHERE ${t.where}`,
      tid,
    ).first<number>('n');
    return n ?? 0;
  }

  async tombstone(tid: string, nowMs: number): Promise<void> {
    await writeTombstone(this.db, tid, nowMs).run();
  }
}
