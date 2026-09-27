/**
 * @fileoverview Upload runner (前端详细设计 算法描述 文件导入): POST /imports
 * (reused when the job already exists for an AI draft) → PUT mapping →
 * batches of ≤ 100 rows sent sequentially with seq 0..n-1 and `last` on the
 * final one. Each batch body stays ≤ 512 KB (a batch that is too large is
 * halved recursively before sending, or after a 413); failures are retried
 * with the same seq after 2 s, 4 s, 8 s (idempotent on the server). The
 * runner is pure logic over injected dependencies and resumable: pass the
 * same {@link UploadState} again to continue after a failure. Only mapped
 * JSON rows are sent — the raw file never leaves the browser.
 */

import type {
  BatchInput,
  BatchResult,
  CreateImportInput,
  JobDto,
  MappingSpec,
  Row,
} from '@ontodecide/integration/contract';
import {CE_LIMITS} from '@ontodecide/shared-kernel';
import {ApiError, isApiError} from '../../shared/api/errors';

/** Retry delays after a failed request, milliseconds. */
export const RETRY_DELAYS_MS: readonly number[] = [2000, 4000, 8000];

/** Batch bounds. */
export interface BatchLimits {
  maxRows: number;
  maxBytes: number;
}

/** Default bounds from CE_LIMITS. */
export const BATCH_LIMITS: BatchLimits = {
  maxRows: CE_LIMITS.batchRows,
  maxBytes: CE_LIMITS.maxBodyBytes,
};

const encoder = new TextEncoder();

/** UTF-8 size of a batch body as sent (worst-case seq digits). */
export function batchBodyBytes(rows: readonly Row[], seq = 10_000): number {
  return encoder.encode(JSON.stringify({seq, last: false, rows})).length;
}

/** A single row does not fit into one request body. */
export class RowTooLargeError extends Error {
  constructor(readonly row: number) {
    super(`Row ${row} exceeds the request body limit`);
    this.name = 'RowTooLargeError';
  }
}

/** The upload was aborted by the user. */
export class UploadAbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'UploadAbortedError';
  }
}

/** A planned batch: the rows and the file row number of the first one. */
export interface PlannedBatch {
  firstRow: number;
  rows: Row[];
}

/** Halves `batch` recursively until every part fits `maxBytes`. */
export function splitToFit(
  batch: PlannedBatch,
  maxBytes: number,
): PlannedBatch[] {
  if (batchBodyBytes(batch.rows) <= maxBytes) return [batch];
  if (batch.rows.length <= 1) throw new RowTooLargeError(batch.firstRow);
  return halve(batch).flatMap(b => splitToFit(b, maxBytes));
}

function halve(batch: PlannedBatch): [PlannedBatch, PlannedBatch] {
  const mid = Math.ceil(batch.rows.length / 2);
  return [
    {firstRow: batch.firstRow, rows: batch.rows.slice(0, mid)},
    {firstRow: batch.firstRow + mid, rows: batch.rows.slice(mid)},
  ];
}

/**
 * Deterministic batch plan: chunks of ≤ `maxRows`, each halved until its
 * JSON body is ≤ `maxBytes`. The index in the result is the seq.
 */
export function planBatches(
  rows: readonly Row[],
  limits: BatchLimits = BATCH_LIMITS,
): PlannedBatch[] {
  const out: PlannedBatch[] = [];
  for (let i = 0; i < rows.length; i += limits.maxRows) {
    const chunk = {firstRow: i + 1, rows: rows.slice(i, i + limits.maxRows)};
    out.push(...splitToFit(chunk, limits.maxBytes));
  }
  return out;
}

/** Dependencies of the runner (API calls and a sleep for retries). */
export interface UploadDeps {
  createImport(input: CreateImportInput): Promise<JobDto>;
  putMapping(id: string, mapping: MappingSpec): Promise<JobDto>;
  submitBatch(
    id: string,
    batch: BatchInput,
    signal?: AbortSignal,
  ): Promise<BatchResult>;
  getImport(id: string): Promise<JobDto>;
  /** Waits `ms` (rejects when `signal` aborts). */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** Progress accumulated from the batch results. */
export interface UploadProgress {
  jobId: string | null;
  batchesDone: number;
  batchesTotal: number;
  rowsSent: number;
  upserted: number;
  skipped: number;
  rejected: number;
  /** Retry attempt of the current batch (0 = first try). */
  attempt: number;
}

/** Mutable, resumable state of one upload. */
export interface UploadState {
  jobId: string | null;
  mappingSet: boolean;
  batches: PlannedBatch[] | null;
  /** Index (= seq) of the next batch to send. */
  next: number;
  progress: UploadProgress;
}

/** Creates the state (optionally for a job created for the AI draft). */
export function newUploadState(jobId: string | null = null): UploadState {
  return {
    jobId,
    mappingSet: false,
    batches: null,
    next: 0,
    progress: {
      jobId,
      batchesDone: 0,
      batchesTotal: 0,
      rowsSent: 0,
      upserted: 0,
      skipped: 0,
      rejected: 0,
      attempt: 0,
    },
  };
}

/** Input of {@link runUpload}. */
export interface UploadInput {
  fileName: string;
  mapping: MappingSpec;
  /** Rows to submit (already projected and cut to the plan). */
  rows: Row[];
  limits?: BatchLimits;
}

/** Whether a failed request may be retried with the same seq. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return !(err instanceof UploadAbortedError);
  if (err.code === 'QUOTA_EXCEEDED') return false;
  if (err.code === 'NETWORK') return true;
  if (err.status === 408) return true;
  if (err.status === 429) return err.code === 'RATE_LIMITED';
  return err.status >= 500;
}

function retryDelay(err: unknown, attempt: number): number {
  const base = RETRY_DELAYS_MS[attempt] ?? 0;
  if (err instanceof ApiError && err.retryAfter !== undefined) {
    return Math.max(base, err.retryAfter * 1000);
  }
  return base;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UploadAbortedError();
}

async function withRetry<T>(
  fn: () => Promise<T>,
  deps: UploadDeps,
  onAttempt: (n: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    checkAbort(signal);
    onAttempt(attempt);
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted || isApiError(e, 'ABORTED')) {
        throw new UploadAbortedError();
      }
      if (!isRetryable(e) || attempt >= RETRY_DELAYS_MS.length) throw e;
      await deps.sleep(retryDelay(e, attempt), signal);
    }
  }
}

/**
 * Runs (or resumes) an upload. Resolves with the final job from
 * `GET /imports/{id}`. Throws the API error that stopped it (e.g.
 * QUOTA_EXCEEDED, or the last error after 3 retries) or
 * {@link UploadAbortedError}; `state` then allows resuming.
 */
export async function runUpload(
  input: UploadInput,
  deps: UploadDeps,
  state: UploadState,
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: UploadProgress) => void;
  } = {},
): Promise<JobDto> {
  const {signal} = opts;
  const limits = input.limits ?? BATCH_LIMITS;
  const emit = () => opts.onProgress?.({...state.progress});
  if (!state.batches) state.batches = planBatches(input.rows, limits);
  state.progress.batchesTotal = state.batches.length;
  emit();

  checkAbort(signal);
  if (!state.jobId) {
    const job = await deps.createImport({
      fileName: input.fileName,
      targetType: input.mapping.targetType,
      totalRows: input.rows.length,
    });
    state.jobId = job.id;
    state.progress.jobId = job.id;
    emit();
  }
  const jobId = state.jobId;
  if (!state.mappingSet) {
    await withRetry(
      () => deps.putMapping(jobId, input.mapping),
      deps,
      () => {},
      signal,
    );
    state.mappingSet = true;
  }

  const batches = state.batches;
  while (state.next < batches.length) {
    const seq = state.next;
    const planned = batches[seq];
    let result: BatchResult;
    try {
      result = await withRetry(
        () =>
          deps.submitBatch(
            jobId,
            {seq, last: seq === batches.length - 1, rows: planned.rows},
            signal,
          ),
        deps,
        n => {
          state.progress.attempt = n;
          if (n > 0) emit();
        },
        signal,
      );
    } catch (e) {
      // 413: the body was not accepted (no seq stored); halve and re-plan.
      if (
        e instanceof ApiError &&
        e.status === 413 &&
        planned.rows.length > 1
      ) {
        batches.splice(seq, 1, ...halve(planned));
        state.progress.batchesTotal = batches.length;
        emit();
        continue;
      }
      throw e;
    }
    state.next = seq + 1;
    const p = state.progress;
    p.batchesDone = state.next;
    p.rowsSent += planned.rows.length;
    p.upserted += result.upserted;
    p.skipped += result.skipped;
    p.rejected += result.rejected.length;
    p.attempt = 0;
    emit();
  }
  checkAbort(signal);
  return deps.getImport(jobId);
}

/** A sleep that rejects with {@link UploadAbortedError} on abort. */
export function abortableSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadAbortedError());
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}
