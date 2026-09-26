/**
 * @fileoverview Job use cases: listing, details, rejected records, replay
 * and per-source data health.
 */

import {AppError, DAY_MS} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {DataHealthDto, JobDto, RawRecordDto} from '../contract';
import {qualityScore} from '../domain';
import {assertSourceActive, createJob, enqueueAll} from './job_progress';
import type {AppDeps} from './ports';
import {requireRole, toJobDto, toRawRecordDto} from './views';

/** Freshness window of data health. */
export const STALE_AFTER_MS = DAY_MS;

/** Lists jobs, newest first. */
export class ListJobs {
  constructor(private readonly deps: AppDeps) {}
  async execute(
    ctx: CallCtx,
    filter: {sourceId?: string; limit?: number} = {},
  ): Promise<JobDto[]> {
    requireRole(ctx, 'Viewer');
    const limit = Math.min(200, Math.max(1, Math.trunc(filter.limit ?? 50)));
    const jobs = await this.deps.jobs.list(ctx, {
      sourceId: filter.sourceId,
      limit,
    });
    return jobs.map(toJobDto);
  }
}

/** Gets one job. */
export class GetJob {
  constructor(private readonly deps: AppDeps) {}
  async execute(ctx: CallCtx, jobId: string): Promise<JobDto> {
    requireRole(ctx, 'Viewer');
    const job = await this.deps.jobs.get(ctx, jobId);
    if (!job) throw new AppError('NOT_FOUND', 'Job not found');
    return toJobDto(job);
  }
}

/** Lists a job's rejected records that were not replayed yet. */
export class ListRejected {
  constructor(private readonly deps: AppDeps) {}
  async execute(ctx: CallCtx, jobId: string): Promise<RawRecordDto[]> {
    requireRole(ctx, 'Operator');
    const job = await this.deps.jobs.get(ctx, jobId);
    if (!job) throw new AppError('NOT_FOUND', 'Job not found');
    return (await this.deps.rawRecords.listForJob(ctx, jobId)).map(
      toRawRecordDto,
    );
  }
}

/**
 * Re-enqueues a job's rejected records (with optional corrected payloads)
 * into a new APPEND job and marks them replayed.
 */
export class ReplayRejected {
  constructor(private readonly deps: AppDeps) {}
  async execute(
    ctx: CallCtx,
    jobId: string,
    fixes: {id: string; payload: Record<string, unknown>}[] = [],
  ): Promise<{requeued: number}> {
    requireRole(ctx, 'Operator');
    const job = await this.deps.jobs.get(ctx, jobId);
    if (!job) throw new AppError('NOT_FOUND', 'Job not found');
    const rows = await this.deps.rawRecords.listForJob(ctx, jobId);
    const byId = new Map(rows.map(r => [r.id, r]));
    for (const f of fixes) {
      if (!byId.has(f.id)) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Rejected record ${f.id} not found in job`,
        );
      }
    }
    const fixed = new Map(fixes.map(f => [f.id, f.payload]));
    const replay = rows
      .map(r => ({id: r.id, payload: fixed.get(r.id) ?? r.payload}))
      // Write-side rejections carry no payload; they need a fix to replay.
      .filter(r => Object.keys(r.payload).length > 0);
    if (replay.length === 0) return {requeued: 0};
    const source = await this.deps.sources.get(ctx, job.sourceId);
    assertSourceActive(source);
    const next = await createJob(this.deps, ctx, source.id, 'APPEND');
    await enqueueAll(
      this.deps,
      ctx,
      next,
      replay.map(r => r.payload),
    );
    await this.deps.rawRecords.markReplayed(
      ctx,
      replay.map(r => r.id),
      this.deps.clock.now().getTime(),
    );
    this.deps.logger.info('rejected records replayed', {
      tenantId: ctx.tenantId,
      jobId,
      replayJobId: next.id,
      requeued: replay.length,
    });
    return {requeued: replay.length};
  }
}

/** Per-source freshness and quality. */
export class DataHealth {
  constructor(private readonly deps: AppDeps) {}
  async execute(ctx: CallCtx): Promise<DataHealthDto[]> {
    requireRole(ctx, 'Viewer');
    const [sources, latest] = await Promise.all([
      this.deps.sources.list(ctx),
      this.deps.jobs.latestPerSource(ctx),
    ]);
    const bySource = new Map(latest.map(j => [j.sourceId, j]));
    const now = this.deps.clock.now().getTime();
    return sources.map(s => {
      const job = bySource.get(s.id);
      const lastAt = Math.max(s.lastJobAt ?? 0, job?.startedAt ?? 0);
      const dto: DataHealthDto = {
        sourceId: s.id,
        name: s.name,
        kind: s.kind,
        enabled: s.enabled && !s.paused,
        qualityScore: job
          ? (job.qualityScore ?? qualityScore(job.received, job.rejected))
          : null,
        stale: lastAt === 0 || now - lastAt > STALE_AFTER_MS,
      };
      if (lastAt > 0) dto.lastJobAt = new Date(lastAt).toISOString();
      if (job) dto.lastStatus = job.status;
      return dto;
    });
  }
}
