/**
 * @fileoverview D1 storage of import jobs, batch results, rejects and saved
 * mappings (data-integration-db; every statement is scoped by tenant_id).
 * int_reject.detail holds the column name (never the cell value).
 */

import {parseJson} from '@ontodecide/shared-kernel';
import {TenantRepository} from '@ontodecide/shared-kernel/d1';
import type {BatchResult, MappingSpec, RejectDto} from '../contract';
import {MAX_STORED_REJECTS} from '../domain';
import type {JobRecord} from '../domain';
import type {BatchCommit, JobRepository, StoredBatch} from '../application';

interface JobRow {
  id: string;
  file_name: string | null;
  target_type: string;
  mapping: string;
  kind: 'file' | 'sample';
  status: JobRecord['status'];
  total_rows: number;
  received: number;
  upserted: number;
  skipped: number;
  rejected: number;
  created_at: number;
  updated_at: number;
}

const JOB_COLUMNS = `id, file_name, target_type, mapping, kind, status,
  total_rows, received, upserted, skipped, rejected, created_at, updated_at`;

function toJob(r: JobRow): JobRecord {
  return {
    id: r.id,
    kind: r.kind,
    fileName: r.file_name,
    targetType: r.target_type,
    mapping: parseJson<MappingSpec | null>(r.mapping, null),
    status: r.status,
    totalRows: r.total_rows,
    received: r.received,
    upserted: r.upserted,
    skipped: r.skipped,
    rejected: r.rejected,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Stored int_batch.result document. */
interface BatchDoc {
  attempt: string;
  result: BatchResult;
  keys: string[];
}

/** {@link JobRepository} over D1. */
export class D1JobRepository extends TenantRepository implements JobRepository {
  async insert(job: JobRecord): Promise<void> {
    await this.stmt(
      `INSERT INTO int_job (tenant_id, ${JOB_COLUMNS})
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      job.id,
      job.fileName,
      job.targetType,
      JSON.stringify(job.mapping),
      job.kind,
      job.status,
      job.totalRows,
      job.received,
      job.upserted,
      job.skipped,
      job.rejected,
      job.createdAt,
      job.updatedAt,
    ).run();
  }

  async get(id: string): Promise<JobRecord | null> {
    const row = await this.stmt(
      `SELECT ${JOB_COLUMNS} FROM int_job WHERE tenant_id = ?1 AND id = ?2`,
      id,
    ).first<JobRow>();
    return row ? toJob(row) : null;
  }

  async list(beforeId: string | null, limit: number): Promise<JobRecord[]> {
    const {results} = await this.stmt(
      `SELECT ${JOB_COLUMNS} FROM int_job
       WHERE tenant_id = ?1 AND (?2 IS NULL OR id < ?2)
       ORDER BY id DESC LIMIT ?3`,
      beforeId,
      limit,
    ).all<JobRow>();
    return results.map(toJob);
  }

  async setMapping(
    id: string,
    mapping: MappingSpec,
    nowMs: number,
  ): Promise<boolean> {
    const res = await this.stmt(
      `UPDATE int_job SET mapping = ?3, updated_at = ?4
       WHERE tenant_id = ?1 AND id = ?2 AND received = 0`,
      id,
      JSON.stringify(mapping),
      nowMs,
    ).run();
    return res.meta.changes === 1;
  }

  async saveMapping(
    name: string | null,
    spec: MappingSpec,
    nowMs: number,
  ): Promise<void> {
    await this.stmt(
      `INSERT INTO int_mapping (tenant_id, id, name, target_type, spec, updated_at)
       VALUES (?1, ?2, ?3, ?2, ?4, ?5)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         name = excluded.name, spec = excluded.spec,
         updated_at = excluded.updated_at`,
      spec.targetType,
      name,
      JSON.stringify(spec),
      nowMs,
    ).run();
  }

  async batches(jobId: string): Promise<StoredBatch[]> {
    const {results} = await this.stmt(
      `SELECT seq, rows, result FROM int_batch
       WHERE tenant_id = ?1 AND job_id = ?2 ORDER BY seq`,
      jobId,
    ).all<{seq: number; rows: number; result: string}>();
    return results.map(r => {
      const doc = parseJson<BatchDoc | null>(r.result, null);
      return {
        seq: r.seq,
        rows: r.rows,
        result: doc?.result ?? {
          seq: r.seq,
          upserted: 0,
          skipped: 0,
          rejected: [],
          job: {
            status: 'RECEIVING',
            received: 0,
            upserted: 0,
            skipped: 0,
            rejected: 0,
          },
        },
        keys: doc?.keys ?? [],
      };
    });
  }

  async commitBatch(c: BatchCommit): Promise<boolean> {
    const doc: BatchDoc = {attempt: c.attempt, result: c.result, keys: c.keys};
    const won = `EXISTS (SELECT 1 FROM int_batch b
        WHERE b.tenant_id = ?1 AND b.job_id = ?2 AND b.seq = ?3
          AND json_extract(b.result, '$.attempt') = ?4)`;
    const [insert] = await this.db.batch([
      this.stmt(
        `INSERT INTO int_batch (tenant_id, job_id, seq, rows, result)
         VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT DO NOTHING`,
        c.jobId,
        c.seq,
        c.rows,
        JSON.stringify(doc),
      ),
      this.stmt(
        `UPDATE int_job SET
           received = received + ?5, upserted = upserted + ?6,
           skipped = skipped + ?7, rejected = rejected + ?8,
           status = CASE WHEN ?9 = 1 AND status = 'RECEIVING'
                         THEN 'DONE' ELSE status END,
           updated_at = ?10
         WHERE tenant_id = ?1 AND id = ?2 AND ${won}`,
        c.jobId,
        c.seq,
        c.attempt,
        c.delta.received,
        c.delta.upserted,
        c.delta.skipped,
        c.delta.rejected,
        c.last ? 1 : 0,
        c.nowMs,
      ),
      this.stmt(
        `INSERT OR IGNORE INTO int_reject
           (tenant_id, job_id, row_no, error_code, detail)
         SELECT ?1, ?2, json_extract(j.value, '$.row'),
                json_extract(j.value, '$.code'),
                json_extract(j.value, '$.column')
         FROM json_each(?5) AS j
         WHERE ${won}
         LIMIT MAX(0, ?6 - (SELECT COUNT(*) FROM int_reject r
                            WHERE r.tenant_id = ?1 AND r.job_id = ?2))`,
        c.jobId,
        c.seq,
        c.attempt,
        JSON.stringify(c.rejects),
        MAX_STORED_REJECTS,
      ),
    ]);
    return insert.meta.changes === 1;
  }

  async rejects(jobId: string): Promise<RejectDto[]> {
    const {results} = await this.stmt(
      `SELECT row_no, error_code, detail FROM int_reject
       WHERE tenant_id = ?1 AND job_id = ?2 ORDER BY row_no LIMIT ?3`,
      jobId,
      MAX_STORED_REJECTS,
    ).all<{row_no: number; error_code: string; detail: string | null}>();
    return results.map(r => ({
      row: r.row_no,
      code: r.error_code,
      ...(r.detail ? {column: r.detail} : {}),
    }));
  }

  async markFailed(id: string, nowMs: number): Promise<void> {
    await this.stmt(
      `UPDATE int_job SET status = 'FAILED', updated_at = ?3
       WHERE tenant_id = ?1 AND id = ?2 AND status = 'RECEIVING'`,
      id,
      nowMs,
    ).run();
  }
}
