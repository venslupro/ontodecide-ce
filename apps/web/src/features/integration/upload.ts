/**
 * @fileoverview File import orchestration: presign → optional raw-file PUT
 * to B2 (progress bar 1) → ≤ 500-record batches, at most 3 in flight
 * (progress bar 2). Backend contract:
 *
 * - `seq` starts at 0 and is contiguous; `last: true` only on the final
 *   batch; every batch carries the `jobId` returned by presign.
 * - `Idempotency-Key = <jobId>:<seq>`.
 * - Failed batches are retried after 2 s, 4 s, 8 s (3 retries); 4xx errors
 *   other than 429 are not retried; 429 waits for `retryAfter`.
 * - presign `url: ''` means B2 is not configured → skip the archive PUT.
 *
 * Every side effect is injected ({@link UploadDeps}) so the module is unit
 * testable with fake timers.
 */

import {INGEST_LIMITS, type TxnType} from '@ontodecide/integration/contract';
import {ApiError} from '../../shared/api/errors';
import {presignUpload, submitBatch, type BatchInput} from './api';

/** Max batches in flight. */
export const UPLOAD_CONCURRENCY = 3;

/** Retry delays in milliseconds (3 retries). */
export const RETRY_DELAYS_MS = [2000, 4000, 8000] as const;

/** Rough per-batch server time used for the estimate (ms). */
export const EST_BATCH_MS = 900;

/** Assumed archive throughput for the estimate (bytes / s). */
export const EST_ARCHIVE_BPS = 2 * 1024 * 1024;

/** Side effects used by {@link runUpload}. */
export interface UploadDeps {
  presign(
    sourceId: string,
    fileName: string,
    bytes: number,
  ): Promise<{url: string; key: string; jobId: string}>;
  putFile(
    url: string,
    file: Blob,
    onProgress: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  submitBatch(
    sourceId: string,
    batch: BatchInput,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<{jobId: string; queuedMessages: number}>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** Progress snapshot. */
export interface UploadProgress {
  phase: 'presign' | 'archive' | 'batches' | 'done';
  /** 0..1 of the raw file PUT (1 when skipped). */
  archive: number;
  archiveSkipped: boolean;
  batchesDone: number;
  batchesTotal: number;
  inFlight: number;
  /** Batches currently waiting for a retry. */
  retrying: number;
  jobId?: string;
}

/** Input of {@link runUpload}. */
export interface UploadInput {
  sourceId: string;
  fileName: string;
  file: Blob;
  batches: Record<string, unknown>[][];
  txnType?: TxnType;
}

/** Splits rows into batches of ≤ 500 records. */
export function planBatches<T>(
  rows: readonly T[],
  size: number = INGEST_LIMITS.batchRecordsMax,
): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Estimated upload duration in seconds. */
export function estimateSeconds(
  batches: number,
  bytes: number,
  archive = true,
): number {
  const waves = Math.ceil(batches / UPLOAD_CONCURRENCY);
  const ms =
    waves * EST_BATCH_MS + (archive ? (bytes / EST_ARCHIVE_BPS) * 1000 : 0);
  return Math.max(1, Math.ceil(ms / 1000));
}

/** Whether a failed batch may be retried, and after how long. */
export function retryDelay(err: unknown, attempt: number): number | null {
  if (attempt >= RETRY_DELAYS_MS.length) return null;
  const backoff = RETRY_DELAYS_MS[attempt];
  const status =
    err instanceof ApiError
      ? err.status
      : (err as {status?: number} | null)?.status;
  if (err instanceof ApiError && err.code === 'ABORTED') return null;
  if (typeof status === 'number' && status === 429) {
    const ra = err instanceof ApiError ? err.retryAfter : undefined;
    return ra !== undefined ? Math.max(ra * 1000, 0) : backoff;
  }
  if (typeof status === 'number' && status >= 400 && status < 500) return null;
  return backoff;
}

/** Idempotency key of one batch. */
export function batchKey(jobId: string, seq: number): string {
  return `${jobId}:${seq}`;
}

/**
 * Runs the whole import. Resolves with the job id once every batch was
 * accepted; rejects with the first non-retryable error (remaining batches
 * are aborted).
 */
export async function runUpload(
  input: UploadInput,
  deps: UploadDeps,
  onProgress: (p: UploadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<{jobId: string; archived: boolean; key: string}> {
  const total = input.batches.length;
  if (total === 0) throw new Error('No records to upload');
  const p: UploadProgress = {
    phase: 'presign',
    archive: 0,
    archiveSkipped: false,
    batchesDone: 0,
    batchesTotal: total,
    inFlight: 0,
    retrying: 0,
  };
  const emit = () => onProgress({...p});
  emit();

  const presigned = await deps.presign(
    input.sourceId,
    input.fileName,
    input.file.size,
  );
  const jobId = presigned.jobId;
  p.jobId = jobId;
  let archived = false;
  if (presigned.url) {
    p.phase = 'archive';
    emit();
    await deps.putFile(
      presigned.url,
      input.file,
      (loaded, t) => {
        p.archive = t > 0 ? loaded / t : 0;
        emit();
      },
      signal,
    );
    archived = true;
    p.archive = 1;
  } else {
    p.archiveSkipped = true;
    p.archive = 1;
  }
  p.phase = 'batches';
  emit();

  const inner = new AbortController();
  const abortAll = () => inner.abort();
  signal?.addEventListener('abort', abortAll, {once: true});
  let next = 0;
  let failure: unknown = null;

  const sendOne = async (seq: number) => {
    const batch: BatchInput = {
      jobId,
      seq,
      last: seq === total - 1,
      records: input.batches[seq],
      ...(input.txnType ? {txnType: input.txnType} : {}),
    };
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.submitBatch(
          input.sourceId,
          batch,
          batchKey(jobId, seq),
          inner.signal,
        );
        return;
      } catch (err) {
        if (failure || inner.signal.aborted) throw err;
        const delay = retryDelay(err, attempt);
        if (delay === null) throw err;
        p.retrying++;
        emit();
        try {
          await deps.sleep(delay, inner.signal);
        } finally {
          p.retrying--;
        }
      }
    }
  };

  const lane = async () => {
    while (!failure && next < total) {
      const seq = next++;
      p.inFlight++;
      emit();
      try {
        await sendOne(seq);
        p.batchesDone++;
      } catch (err) {
        if (!failure) failure = err;
        inner.abort();
      } finally {
        p.inFlight--;
        emit();
      }
    }
  };

  try {
    await Promise.all(
      Array.from({length: Math.min(UPLOAD_CONCURRENCY, total)}, lane),
    );
  } finally {
    signal?.removeEventListener('abort', abortAll);
  }
  if (failure) throw failure;
  p.phase = 'done';
  emit();
  return {jobId, archived, key: presigned.key};
}

/** Abortable sleep (default {@link UploadDeps.sleep}). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError({code: 'ABORTED', status: 0}));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new ApiError({code: 'ABORTED', status: 0}));
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

/** PUTs a Blob with XMLHttpRequest (for upload progress events). */
export function xhrPut(
  url: string,
  file: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = e =>
      onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size, file.size);
        resolve();
      } else {
        reject(
          new ApiError({
            code: 'UPSTREAM_FAILED',
            status: xhr.status,
            detail: `archive PUT ${xhr.status}`,
          }),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new ApiError({
          code: 'NETWORK',
          status: 0,
          detail: 'archive PUT failed',
        }),
      );
    xhr.onabort = () => reject(new ApiError({code: 'ABORTED', status: 0}));
    signal?.addEventListener('abort', () => xhr.abort(), {once: true});
    xhr.send(file);
  });
}

/** Production dependencies (REST client + XHR + real timers). */
export function browserUploadDeps(): UploadDeps {
  return {presign: presignUpload, putFile: xhrPut, submitBatch, sleep};
}
