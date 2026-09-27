/**
 * @fileoverview Synchronous batch ingestion (详细设计 6.11.2): map →
 * validate → one ObjectGraphRpc.upsertBatch → store the result in int_batch
 * (a retried seq returns it) → update the job counters. Shared by file
 * imports (submitBatch) and the sample scenario.
 */

import {AppError, utcDay} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {CompiledSchema} from '@ontodecide/ontology/contract';
import type {
  BatchInput,
  BatchResult,
  MappingSpec,
  RejectDto,
  Row,
} from '../contract';
import {
  applyDelta,
  assertMapping,
  effectiveStatus,
  jobCounters,
  mapRows,
  rejectedRows,
} from '../domain';
import type {JobRecord} from '../domain';
import {importRowsRef, requireJob} from './import_handlers';
import type {IntegrationDeps, StoredBatch} from './ports';

/** Rows per synchronous batch. */
export const MAX_BATCH_ROWS = 100;

/** One batch to ingest into a job. */
export interface IngestInput {
  job: JobRecord;
  seq: number;
  last: boolean;
  rows: readonly Row[];
  mapping: MappingSpec;
  schema: CompiledSchema;
  /** Batches already stored for the job. */
  prior: readonly StoredBatch[];
}

/** Result of {@link ingestBatch} with the job after the batch. */
export interface IngestOutput {
  result: BatchResult;
  job: JobRecord;
  /** False when a concurrent attempt stored the same seq first. */
  won: boolean;
}

function mergeRejects(
  own: readonly RejectDto[],
  graph: readonly {row: number; code: string}[],
): RejectDto[] {
  const seen = new Set<string>();
  const out: RejectDto[] = [];
  // object-graph details may echo values: keep row and code only.
  for (const r of [...own, ...graph.map(g => ({row: g.row, code: g.code}))]) {
    const k = `${r.row}:${r.code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort((a, b) => a.row - b.row);
}

/** Maps, validates and writes one batch; see the file overview. */
export async function ingestBatch(
  deps: IntegrationDeps,
  ctx: CallCtx,
  input: IngestInput,
): Promise<IngestOutput> {
  const {job, seq, rows, prior} = input;
  const type = assertMapping(input.mapping, input.schema);
  const firstRow =
    prior.filter(b => b.seq < seq).reduce((n, b) => n + b.rows, 0) + 1;
  const seen = new Set(prior.flatMap(b => b.keys));
  const mapped = mapRows({
    rows,
    firstRow,
    mapping: input.mapping,
    type,
    seen,
  });

  let upserted = 0;
  let skipped = 0;
  let graphRejects: {row: number; code: string}[] = [];
  if (mapped.cmds.length > 0) {
    const w = await deps.objects.upsertBatch(ctx, {
      jobId: job.id,
      seq,
      cmds: mapped.cmds,
    });
    upserted = w.upserted;
    skipped = w.skipped;
    graphRejects = w.rejected;
  }
  const rejected = mergeRejects(mapped.rejects, graphRejects);
  const failedRows = new Set(
    graphRejects
      .filter(r => r.code === 'OBJECT_LIMIT' || r.code === 'UNKNOWN_TYPE')
      .map(r => r.row),
  );
  // Rows object-graph did not write do not block a later row with the key.
  const keys = mapped.cmds.flatMap((c, i) =>
    failedRows.has(c.row) ? [] : [mapped.keys[i]],
  );

  const nowMs = deps.clock.now().getTime();
  const delta = {
    received: rows.length,
    upserted,
    skipped,
    rejected: rejectedRows(rejected),
  };
  const after = applyDelta(job, delta, input.last, nowMs);
  const result: BatchResult = {
    seq,
    upserted,
    skipped,
    rejected,
    job: jobCounters(after, nowMs),
  };
  const won = await deps.jobs(ctx).commitBatch({
    jobId: job.id,
    seq,
    rows: rows.length,
    attempt: deps.newId(nowMs),
    result,
    keys,
    delta,
    last: input.last,
    rejects: rejected,
    nowMs,
  });
  return {result, job: after, won};
}

/**
 * POST /imports/{id}/batches. A stored seq returns its first result; a job
 * that is DONE or stale (FAILED) is CONFLICT; rows beyond the reserved
 * `totalRows` are QUOTA_EXCEEDED. On `last`, unused reserved rows of today
 * are released.
 */
export async function submitBatch(
  deps: IntegrationDeps,
  ctx: CallCtx,
  jobId: string,
  batch: BatchInput,
): Promise<BatchResult> {
  if (batch.rows.length > MAX_BATCH_ROWS) {
    throw new AppError('VALIDATION_FAILED', `At most ${MAX_BATCH_ROWS} rows`);
  }
  const job = await requireJob(deps, ctx, jobId);
  const jobs = deps.jobs(ctx);
  const prior = await jobs.batches(jobId);
  const stored = prior.find(b => b.seq === batch.seq);
  if (stored) return stored.result;

  const now = deps.clock.now();
  const status = effectiveStatus(job, now.getTime());
  if (job.kind !== 'file') throw new AppError('CONFLICT', 'SAMPLE_JOB');
  if (status !== 'RECEIVING') {
    throw new AppError('CONFLICT', `IMPORT_${status}`, {extras: {status}});
  }
  if (!job.mapping) throw new AppError('CONFLICT', 'MAPPING_MISSING');
  if (job.received + batch.rows.length > job.totalRows) {
    throw new AppError('QUOTA_EXCEEDED', 'IMPORT_TOTAL_ROWS', {
      extras: {received: job.received, totalRows: job.totalRows},
    });
  }

  const schema = await deps.ontology.getCompiledSchema(ctx);
  const out = await ingestBatch(deps, ctx, {
    job,
    seq: batch.seq,
    last: batch.last,
    rows: batch.rows,
    mapping: job.mapping,
    schema,
    prior,
  });
  if (!out.won) {
    const again = (await jobs.batches(jobId)).find(b => b.seq === batch.seq);
    if (again) return again.result;
  }
  if (out.won && batch.last) {
    const unused = job.totalRows - out.job.received;
    if (unused > 0 && utcDay(new Date(job.createdAt)) === utcDay(now)) {
      await deps.usage.adjust(importRowsRef(ctx, now), -unused);
    }
  }
  return out.result;
}
