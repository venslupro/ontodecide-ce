/**
 * @fileoverview D1 repository for int_job and its idempotent progress
 * tables (int_job_batch, int_ingest_msg, int_job_group, int_raw_record).
 *
 * Progress updates run as one D1 batch (a transaction) that starts with a
 * plain INSERT of the dedup key; a duplicate violates the primary key, the
 * whole batch rolls back and the method returns false.
 */

import {ulid} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {
  IngestProgress,
  JobRecord,
  JobRepository,
  RejectedRow,
} from '../application';
import type {JobStatus, TxnType} from '../contract';

interface JobRow {
  id: string;
  tenant_id: string;
  source_id: string;
  txn_type: string;
  status: string;
  received: number;
  upserted: number;
  merged: number;
  skipped: number;
  rejected: number;
  warnings: number;
  total_groups: number;
  done_groups: number;
  last_seq: number | null;
  batches: number;
  ingest_total: number;
  ingest_done: number;
  quality_score: number | null;
  b2_key: string | null;
  started_at: number;
  finished_at: number | null;
}

const COLUMNS =
  'id, tenant_id, source_id, txn_type, status, received, upserted, merged, skipped, rejected, ' +
  'warnings, total_groups, done_groups, last_seq, batches, ingest_total, ingest_done, ' +
  'quality_score, b2_key, started_at, finished_at';

function fromRow(r: JobRow): JobRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    sourceId: r.source_id,
    txnType: r.txn_type as TxnType,
    status: r.status as JobStatus,
    received: r.received,
    upserted: r.upserted,
    merged: r.merged,
    skipped: r.skipped,
    rejected: r.rejected,
    warnings: r.warnings,
    totalGroups: r.total_groups,
    doneGroups: r.done_groups,
    lastSeq: r.last_seq,
    batches: r.batches,
    ingestTotal: r.ingest_total,
    ingestDone: r.ingest_done,
    qualityScore: r.quality_score,
    b2Key: r.b2_key,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

/** Whether an error is a primary-key / unique violation. */
export function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed|PRIMARY KEY|SQLITE_CONSTRAINT/i.test(msg);
}

/** int_job over D1. */
export class D1JobRepository implements JobRepository {
  constructor(private readonly db: D1Database) {}

  async create(job: JobRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO int_job (id, tenant_id, source_id, txn_type, status, b2_key, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        job.id,
        job.tenantId,
        job.sourceId,
        job.txnType,
        job.status,
        job.b2Key,
        job.startedAt,
      )
      .run();
  }

  async get(ctx: CallCtx, id: string): Promise<JobRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM int_job WHERE tenant_id = ? AND id = ?`)
      .bind(ctx.tenantId, id)
      .first<JobRow>();
    return row ? fromRow(row) : null;
  }

  async list(
    ctx: CallCtx,
    filter: {sourceId?: string; limit: number},
  ): Promise<JobRecord[]> {
    const stmt = filter.sourceId
      ? this.db
          .prepare(
            `SELECT ${COLUMNS} FROM int_job WHERE tenant_id = ? AND source_id = ?
             ORDER BY started_at DESC, id DESC LIMIT ?`,
          )
          .bind(ctx.tenantId, filter.sourceId, filter.limit)
      : this.db
          .prepare(
            `SELECT ${COLUMNS} FROM int_job WHERE tenant_id = ?
             ORDER BY started_at DESC, id DESC LIMIT ?`,
          )
          .bind(ctx.tenantId, filter.limit);
    const {results} = await stmt.all<JobRow>();
    return results.map(fromRow);
  }

  async latestPerSource(ctx: CallCtx): Promise<JobRecord[]> {
    const {results} = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM int_job j
         WHERE j.tenant_id = ? AND j.id = (
           SELECT k.id FROM int_job k WHERE k.tenant_id = j.tenant_id AND k.source_id = j.source_id
           ORDER BY k.started_at DESC, k.id DESC LIMIT 1)`,
      )
      .bind(ctx.tenantId)
      .all<JobRow>();
    return results.map(fromRow);
  }

  async findBatch(
    ctx: CallCtx,
    jobId: string,
    seq: number,
  ): Promise<{messages: number} | null> {
    const row = await this.db
      .prepare(
        'SELECT messages FROM int_job_batch WHERE tenant_id = ? AND job_id = ? AND seq = ?',
      )
      .bind(ctx.tenantId, jobId, seq)
      .first<{messages: number}>();
    return row ? {messages: row.messages} : null;
  }

  async recordBatch(
    ctx: CallCtx,
    jobId: string,
    b: {seq: number; last: boolean; records: number; messages: number},
    now: number,
  ): Promise<boolean> {
    return this.once([
      this.db
        .prepare(
          `INSERT INTO int_job_batch (tenant_id, job_id, seq, records, messages, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(ctx.tenantId, jobId, b.seq, b.records, b.messages, now),
      this.db
        .prepare(
          `UPDATE int_job SET received = received + ?, ingest_total = ingest_total + ?,
             batches = batches + 1, last_seq = CASE WHEN ? = 1 THEN ? ELSE last_seq END
           WHERE tenant_id = ? AND id = ?`,
        )
        .bind(
          b.records,
          b.messages,
          b.last ? 1 : 0,
          b.seq,
          ctx.tenantId,
          jobId,
        ),
    ]);
  }

  async isIngestProcessed(
    ctx: CallCtx,
    jobId: string,
    seq: number,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        'SELECT 1 AS x FROM int_ingest_msg WHERE tenant_id = ? AND job_id = ? AND seq = ?',
      )
      .bind(ctx.tenantId, jobId, seq)
      .first();
    return row !== null;
  }

  async recordIngest(
    ctx: CallCtx,
    jobId: string,
    p: IngestProgress,
    now: number,
  ): Promise<boolean> {
    return this.once([
      this.db
        .prepare(
          `INSERT INTO int_ingest_msg (tenant_id, job_id, seq, groups, processed_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(ctx.tenantId, jobId, p.seq, p.groups, now),
      ...this.rawInserts(ctx, jobId, p.rejected, now),
      this.db
        .prepare(
          `UPDATE int_job SET ingest_done = ingest_done + 1, total_groups = total_groups + ?,
             rejected = rejected + ?, warnings = warnings + ?
           WHERE tenant_id = ? AND id = ?`,
        )
        .bind(p.groups, p.rejected.length, p.warnings, ctx.tenantId, jobId),
    ]);
  }

  async recordGroup(
    ctx: CallCtx,
    jobId: string,
    seq: number,
    r: {
      upserted: number;
      merged: number;
      skipped: number;
      rejected: RejectedRow[];
    },
    now: number,
  ): Promise<boolean> {
    return this.once([
      // int_job_group has no tenant column; the job was checked by the caller.
      this.db
        .prepare(
          'INSERT INTO int_job_group (job_id, seq, reported_at) VALUES (?, ?, ?)',
        )
        .bind(jobId, seq, now),
      ...this.rawInserts(ctx, jobId, r.rejected, now),
      this.db
        .prepare(
          `UPDATE int_job SET done_groups = done_groups + 1, upserted = upserted + ?,
             merged = merged + ?, skipped = skipped + ?, rejected = rejected + ?
           WHERE tenant_id = ? AND id = ?`,
        )
        .bind(
          r.upserted,
          r.merged,
          r.skipped,
          r.rejected.length,
          ctx.tenantId,
          jobId,
        ),
    ]);
  }

  async markRunning(ctx: CallCtx, jobId: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE int_job SET status = 'Running' WHERE tenant_id = ? AND id = ? AND status = 'Queued'",
      )
      .bind(ctx.tenantId, jobId)
      .run();
  }

  async finish(
    ctx: CallCtx,
    jobId: string,
    status: JobStatus,
    qualityScore: number,
    finishedAt: number,
  ): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE int_job SET status = ?, quality_score = ?, finished_at = ?
         WHERE tenant_id = ? AND id = ? AND finished_at IS NULL`,
      )
      .bind(status, qualityScore, finishedAt, ctx.tenantId, jobId)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /** One statement for all rows (D1 caps statements per invocation). */
  private rawInserts(
    ctx: CallCtx,
    jobId: string,
    rows: RejectedRow[],
    now: number,
  ): D1PreparedStatement[] {
    if (rows.length === 0) return [];
    const items = rows.map(r => ({
      id: ulid(now),
      row: r.row,
      payload: JSON.stringify(r.payload),
      code: r.code,
      detail: r.detail ?? null,
    }));
    return [
      this.db
        .prepare(
          `INSERT INTO int_raw_record
             (id, tenant_id, job_id, row_no, payload, error_code, error_detail, created_at)
           SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.row'),
             json_extract(value, '$.payload'), json_extract(value, '$.code'),
             json_extract(value, '$.detail'), ?
           FROM json_each(?)`,
        )
        .bind(ctx.tenantId, jobId, now, JSON.stringify(items)),
    ];
  }

  private async once(stmts: D1PreparedStatement[]): Promise<boolean> {
    try {
      await this.db.batch(stmts);
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  }
}
