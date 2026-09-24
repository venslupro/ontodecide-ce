/**
 * @fileoverview Scheduled use cases (cron every 15 minutes): incremental
 * REST pulls and retention cleanup. Each run is recorded in ops_job_run.
 */

import {DAY_MS, HOUR_MS, systemCtx} from '@ontodecide/shared-kernel';
import type {RestSourceConfig} from '../contract';
import {INGEST_LIMITS} from '../contract';
import {extractItems, selectJsonPath} from '../domain';
import {createJob, enqueueAll} from './job_progress';
import type {AppDeps, SourceRecord} from './ports';

/** Rejected records are kept for 30 days. */
export const RAW_RECORD_TTL_MS = 30 * DAY_MS;
/** Webhook nonces are kept for 1 hour (window is 5 minutes). */
export const NONCE_TTL_MS = HOUR_MS;

/** Outcome of pulling one source. */
export interface PullOutcome {
  sourceId: string;
  records: number;
  jobId?: string;
  error?: string;
}

/** Pulls every enabled, unpaused REST source once. */
export class PullRestSources {
  constructor(private readonly deps: AppDeps) {}

  async execute(): Promise<PullOutcome[]> {
    const runId = this.deps.newId();
    const started = this.deps.clock.now().getTime();
    await this.deps.maintenance.startRun(runId, 'rest-pull', started);
    const outcomes: PullOutcome[] = [];
    for (const source of await this.deps.sources.listPullable()) {
      try {
        outcomes.push(await this.pull(source));
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.deps.logger.warn('rest pull failed', {
          tenantId: source.tenantId,
          sourceId: source.id,
          error,
        });
        outcomes.push({sourceId: source.id, records: 0, error});
      }
    }
    const failures = outcomes.filter(o => o.error).length;
    await this.deps.maintenance.finishRun(
      runId,
      failures > 0 && failures === outcomes.length ? 'error' : 'ok',
      this.deps.clock.now().getTime(),
      {
        sources: outcomes.length,
        jobs: outcomes.filter(o => o.jobId).length,
        records: outcomes.reduce((n, o) => n + o.records, 0),
        failures,
      },
    );
    return outcomes;
  }

  /** Pulls one page from one source. */
  async pull(source: SourceRecord): Promise<PullOutcome> {
    const cfg = source.config as unknown as RestSourceConfig;
    const ctx = systemCtx(source.tenantId, `rest-pull:${source.id}`);
    const url = new URL(cfg.url);
    if (cfg.cursorParam && source.cursor)
      url.searchParams.set(cfg.cursorParam, source.cursor);
    const secrets = source.secretEnc
      ? await this.deps.cipher.open(source.secretEnc)
      : {};
    const headers = {
      accept: 'application/json',
      ...(cfg.headers ?? {}),
      ...(secrets.secretHeaders ?? {}),
    };
    const res = await this.deps.rest.get(url.toString(), {
      method: cfg.method ?? 'GET',
      headers,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }
    const limit = Math.min(
      cfg.pageLimit ?? INGEST_LIMITS.restPageLimitMax,
      INGEST_LIMITS.restPageLimitMax,
    );
    const records = extractItems(res.body, cfg.itemsPath)
      .filter(
        (r): r is Record<string, unknown> =>
          !!r && typeof r === 'object' && !Array.isArray(r),
      )
      .slice(0, limit);
    let jobId: string | undefined;
    if (records.length > 0) {
      const job = await createJob(this.deps, ctx, source.id, 'APPEND');
      await enqueueAll(this.deps, ctx, job, records);
      jobId = job.id;
    }
    if (cfg.cursorPath) {
      const next = selectJsonPath(res.body, cfg.cursorPath);
      if (next !== undefined && next !== null && next !== '') {
        await this.deps.sources.setCursor(ctx, source.id, String(next));
      }
    }
    return {
      sourceId: source.id,
      records: records.length,
      ...(jobId ? {jobId} : {}),
    };
  }
}

/** Deletes expired rejected records, nonces and progress rows. */
export class RunCleanup {
  constructor(private readonly deps: AppDeps) {}

  async execute(): Promise<{
    rawRecords: number;
    nonces: number;
    progress: number;
  }> {
    const runId = this.deps.newId();
    const now = this.deps.clock.now().getTime();
    await this.deps.maintenance.startRun(runId, 'cleanup', now);
    const rawRecords = await this.deps.maintenance.purgeRawRecords(
      now - RAW_RECORD_TTL_MS,
    );
    const nonces = await this.deps.maintenance.purgeNonces(now - NONCE_TTL_MS);
    const progress = await this.deps.maintenance.purgeProgress(
      now - RAW_RECORD_TTL_MS,
    );
    const detail = {rawRecords, nonces, progress};
    await this.deps.maintenance.finishRun(
      runId,
      'ok',
      this.deps.clock.now().getTime(),
      detail,
    );
    return detail;
  }
}
