/**
 * @fileoverview D1 repository for rejected records (int_raw_record).
 */

import {parseJson} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {RawRecordRepository, RawRecordRow} from '../application';

interface Row {
  id: string;
  job_id: string;
  row_no: number;
  payload: string;
  error_code: string;
  error_detail: string | null;
  replayed_at: number | null;
  created_at: number;
}

/** Maximum rejected records returned per job. */
export const REJECTED_LIST_MAX = 1000;

/** int_raw_record over D1. */
export class D1RawRecordRepository implements RawRecordRepository {
  constructor(private readonly db: D1Database) {}

  async listForJob(
    ctx: CallCtx,
    jobId: string,
    opts: {includeReplayed?: boolean} = {},
  ): Promise<RawRecordRow[]> {
    const {results} = await this.db
      .prepare(
        `SELECT id, job_id, row_no, payload, error_code, error_detail, replayed_at, created_at
         FROM int_raw_record
         WHERE tenant_id = ? AND job_id = ? ${opts.includeReplayed ? '' : 'AND replayed_at IS NULL'}
         ORDER BY row_no, id LIMIT ?`,
      )
      .bind(ctx.tenantId, jobId, REJECTED_LIST_MAX)
      .all<Row>();
    return results.map(r => ({
      id: r.id,
      jobId: r.job_id,
      rowNo: r.row_no,
      payload: parseJson<Record<string, unknown>>(r.payload, {}),
      errorCode: r.error_code,
      errorDetail: r.error_detail,
      replayedAt: r.replayed_at,
      createdAt: r.created_at,
    }));
  }

  async markReplayed(ctx: CallCtx, ids: string[], at: number): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .prepare(
        `UPDATE int_raw_record SET replayed_at = ?
         WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))`,
      )
      .bind(at, ctx.tenantId, JSON.stringify(ids))
      .run();
  }
}
