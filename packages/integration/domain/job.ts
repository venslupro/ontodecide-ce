/**
 * @fileoverview Import job model (详细设计 6.11.2): status derivation (a job
 * without a batch for 30 minutes reads as FAILED), counters and DTO views.
 */

import type {
  BatchResult,
  JobDto,
  JobStatus,
  MappingSpec,
  RejectDto,
} from '../contract';

/** A job without new batches for this long reads as FAILED. */
export const STALE_JOB_MS = 30 * 60_000;

/** Rejects stored per job (the rest are only counted). */
export const MAX_STORED_REJECTS = 200;

/** Persistent job state. Times are Unix milliseconds. */
export interface JobRecord {
  id: string;
  kind: 'file' | 'sample';
  fileName: string | null;
  targetType: string;
  mapping: MappingSpec | null;
  status: JobStatus;
  totalRows: number;
  received: number;
  upserted: number;
  skipped: number;
  rejected: number;
  createdAt: number;
  updatedAt: number;
}

/** Status as seen by readers: stale RECEIVING jobs are FAILED. */
export function effectiveStatus(job: JobRecord, nowMs: number): JobStatus {
  if (job.status === 'RECEIVING' && nowMs - job.updatedAt > STALE_JOB_MS) {
    return 'FAILED';
  }
  return job.status;
}

/** Counter deltas of one batch. */
export interface BatchDelta {
  received: number;
  upserted: number;
  skipped: number;
  rejected: number;
}

/** Applies a batch delta (and `last`) to a job snapshot. */
export function applyDelta(
  job: JobRecord,
  d: BatchDelta,
  last: boolean,
  nowMs: number,
): JobRecord {
  return {
    ...job,
    received: job.received + d.received,
    upserted: job.upserted + d.upserted,
    skipped: job.skipped + d.skipped,
    rejected: job.rejected + d.rejected,
    status: last && job.status === 'RECEIVING' ? 'DONE' : job.status,
    updatedAt: nowMs,
  };
}

/** Counters of a job as returned with a batch result. */
export function jobCounters(job: JobRecord, nowMs: number): BatchResult['job'] {
  return {
    status: effectiveStatus(job, nowMs),
    received: job.received,
    upserted: job.upserted,
    skipped: job.skipped,
    rejected: job.rejected,
  };
}

/** Converts a job to its DTO (rejects only for GET /imports/{id}). */
export function toJobDto(
  job: JobRecord,
  nowMs: number,
  rejects?: RejectDto[],
): JobDto {
  return {
    id: job.id,
    kind: job.kind,
    fileName: job.fileName,
    targetType: job.targetType,
    mapping: job.mapping,
    status: effectiveStatus(job, nowMs),
    totalRows: job.totalRows,
    received: job.received,
    upserted: job.upserted,
    skipped: job.skipped,
    rejected: job.rejected,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    ...(rejects ? {rejects} : {}),
  };
}

/** Number of distinct rows among rejects. */
export function rejectedRows(rejects: readonly RejectDto[]): number {
  return new Set(rejects.map(r => r.row)).size;
}
