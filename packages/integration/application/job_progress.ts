/**
 * @fileoverview Shared job services: job creation, batch enqueueing and the
 * completion check that runs after every progress update.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {IngestMsg, TxnType} from '../contract';
import {INGEST_LIMITS} from '../contract';
import {
  batchRowOffset,
  finalStatus,
  ingestSeq,
  isJobComplete,
  qualityScore,
  splitRecords,
} from '../domain';
import type {AppDeps, JobRecord, SourceRecord} from './ports';

/** Creates a Queued job for a source. */
export async function createJob(
  deps: AppDeps,
  ctx: CallCtx,
  sourceId: string,
  txnType: TxnType,
  opts: {id?: string; b2Key?: string} = {},
): Promise<JobRecord> {
  const now = deps.clock.now().getTime();
  const job: JobRecord = {
    id: opts.id ?? deps.newId(),
    tenantId: ctx.tenantId,
    sourceId,
    txnType,
    status: 'Queued',
    received: 0,
    upserted: 0,
    merged: 0,
    skipped: 0,
    rejected: 0,
    warnings: 0,
    totalGroups: 0,
    doneGroups: 0,
    lastSeq: null,
    batches: 0,
    ingestTotal: 0,
    ingestDone: 0,
    qualityScore: null,
    b2Key: opts.b2Key ?? null,
    startedAt: now,
    finishedAt: null,
  };
  await deps.jobs.create(job);
  await deps.sources.touchLastJob(ctx, sourceId, now);
  return job;
}

/** Finishes the job when every part has been processed. */
export async function checkJobCompletion(
  deps: AppDeps,
  ctx: CallCtx,
  jobId: string,
): Promise<boolean> {
  const job = await deps.jobs.get(ctx, jobId);
  if (!job || job.finishedAt !== null || !isJobComplete(job)) return false;
  const status = finalStatus(job);
  const q = qualityScore(job.received, job.rejected);
  const done = await deps.jobs.finish(
    ctx,
    jobId,
    status,
    q,
    deps.clock.now().getTime(),
  );
  if (done) {
    deps.logger.info('job finished', {
      tenantId: ctx.tenantId,
      jobId,
      status,
      received: job.received,
      rejected: job.rejected,
    });
  }
  return done;
}

/** Throws unless the source can accept data. */
export function assertSourceActive(
  source: SourceRecord | null,
): asserts source is SourceRecord {
  if (!source) throw new AppError('SOURCE_NOT_FOUND');
  if (!source.enabled) throw new AppError('CONFLICT', 'Source is disabled');
  if (source.paused) {
    throw new AppError(
      'CONFLICT',
      'Source is paused after an ontology breaking change',
    );
  }
}

/**
 * Splits one batch into ingest messages, enqueues them and records the
 * batch. Re-submitting the same (job, seq) enqueues nothing.
 */
export async function enqueueBatch(
  deps: AppDeps,
  ctx: CallCtx,
  job: Pick<JobRecord, 'id' | 'sourceId'>,
  batch: {seq: number; last: boolean; records: Record<string, unknown>[]},
): Promise<number> {
  const existing = await deps.jobs.findBatch(ctx, job.id, batch.seq);
  if (existing) return existing.messages;
  const chunks = splitRecords(batch.records);
  const base = batchRowOffset(batch.seq, INGEST_LIMITS.batchRecordsMax);
  const msgs: IngestMsg[] = chunks.map((c, n) => ({
    ctx,
    sourceId: job.sourceId,
    jobId: job.id,
    seq: ingestSeq(batch.seq, n),
    last: batch.last && n === chunks.length - 1,
    rowOffset: base + c.offset,
    records: c.records,
  }));
  if (msgs.length > 0) await deps.ingestQueue.publish(msgs);
  await deps.jobs.recordBatch(
    ctx,
    job.id,
    {
      seq: batch.seq,
      last: batch.last,
      records: batch.records.length,
      messages: msgs.length,
    },
    deps.clock.now().getTime(),
  );
  await checkJobCompletion(deps, ctx, job.id);
  return msgs.length;
}

/** Enqueues records as consecutive batches of ≤ 500 into a fresh job. */
export async function enqueueAll(
  deps: AppDeps,
  ctx: CallCtx,
  job: Pick<JobRecord, 'id' | 'sourceId'>,
  records: Record<string, unknown>[],
): Promise<number> {
  const size = INGEST_LIMITS.batchRecordsMax;
  const count = Math.max(1, Math.ceil(records.length / size));
  let messages = 0;
  for (let seq = 0; seq < count; seq++) {
    messages += await enqueueBatch(deps, ctx, job, {
      seq,
      last: seq === count - 1,
      records: records.slice(seq * size, (seq + 1) * size),
    });
  }
  return messages;
}
