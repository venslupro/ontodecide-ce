/**
 * @fileoverview Retention cleanup and ops_job_run bookkeeping. These are
 * cross-tenant system maintenance statements run by the cron.
 */

import type {MaintenanceRepository} from '../application';

/** Maintenance statements over D1. */
export class D1MaintenanceRepository implements MaintenanceRepository {
  constructor(private readonly db: D1Database) {}

  async purgeRawRecords(before: number): Promise<number> {
    return this.del('DELETE FROM int_raw_record WHERE created_at < ?', before);
  }

  async purgeNonces(before: number): Promise<number> {
    return this.del('DELETE FROM int_webhook_nonce WHERE ts < ?', before);
  }

  async purgeProgress(before: number): Promise<number> {
    const a = await this.del(
      'DELETE FROM int_ingest_msg WHERE processed_at < ?',
      before,
    );
    const b = await this.del(
      'DELETE FROM int_job_batch WHERE created_at < ?',
      before,
    );
    const c = await this.del(
      'DELETE FROM int_job_group WHERE reported_at < ?',
      before,
    );
    return a + b + c;
  }

  async startRun(id: string, job: string, at: number): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO ops_job_run (id, job, started_at, status) VALUES (?, ?, ?, 'running')",
      )
      .bind(id, job, at)
      .run();
  }

  async finishRun(
    id: string,
    status: 'ok' | 'error',
    at: number,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE ops_job_run SET status = ?, finished_at = ?, detail = ? WHERE id = ?',
      )
      .bind(status, at, JSON.stringify(detail), id)
      .run();
  }

  private async del(sql: string, before: number): Promise<number> {
    const res = await this.db.prepare(sql).bind(before).run();
    return res.meta?.changes ?? 0;
  }
}
