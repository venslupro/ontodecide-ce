/**
 * @fileoverview Upload orchestration against the backend contract: seq
 * contiguous from 0, `last` only on the final batch, same jobId,
 * Idempotency-Key `jobId:seq`, ≤ 3 in flight, retries after 2/4/8 s,
 * no retry on 4xx (except 429), presign url '' skips the archive PUT.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError} from '../../shared/api/errors';
import type {BatchInput} from './api';
import {
  estimateSeconds,
  planBatches,
  runUpload,
  sleep,
  type UploadDeps,
  type UploadProgress,
} from './upload';

interface Call {
  batch: BatchInput;
  key: string;
}

function rows(n: number) {
  return Array.from({length: n}, (_, i) => ({id: `K-${i}`}));
}

function makeDeps(
  opts: {
    url?: string;
    fail?: (seq: number, attempt: number) => unknown;
    delayMs?: number;
  } = {},
) {
  const calls: Call[] = [];
  const attempts = new Map<number, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const putFile = vi.fn(
    async (
      _url: string,
      file: Blob,
      onProgress: (l: number, t: number) => void,
    ) => {
      onProgress(file.size / 2, file.size);
      onProgress(file.size, file.size);
    },
  );
  const sleeps: number[] = [];
  const deps: UploadDeps = {
    presign: vi.fn(async () => ({
      url: opts.url ?? '',
      key: 'raw/t1/x.csv',
      jobId: 'job-7',
    })),
    putFile,
    submitBatch: vi.fn(
      async (_sourceId: string, batch: BatchInput, key: string) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await new Promise(r => setTimeout(r, opts.delayMs ?? 5));
          const attempt = attempts.get(batch.seq) ?? 0;
          attempts.set(batch.seq, attempt + 1);
          calls.push({batch, key});
          const err = opts.fail?.(batch.seq, attempt);
          if (err) throw err;
          return {jobId: batch.jobId ?? '', queuedMessages: 1};
        } finally {
          inFlight--;
        }
      },
    ),
    sleep: vi.fn((ms: number, signal?: AbortSignal) => {
      sleeps.push(ms);
      return sleep(ms, signal);
    }),
  };
  return {deps, calls, sleeps, putFile, max: () => maxInFlight};
}

const file = new Blob(['id\nK-0\n'], {type: 'text/csv'});

describe('runUpload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends contiguous seqs from 0 with the presigned jobId, last only on the final batch', async () => {
    const {deps, calls, max, putFile} = makeDeps();
    const progress: UploadProgress[] = [];
    const p = runUpload(
      {
        sourceId: 'src-1',
        fileName: 'x.csv',
        file,
        batches: planBatches(rows(2345)),
        txnType: 'APPEND',
      },
      deps,
      s => progress.push(s),
    );
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res).toEqual({jobId: 'job-7', archived: false, key: 'raw/t1/x.csv'});
    const seqs = calls.map(c => c.batch.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([0, 1, 2, 3, 4]);
    expect(calls.every(c => c.batch.jobId === 'job-7')).toBe(true);
    expect(calls.every(c => c.key === `job-7:${c.batch.seq}`)).toBe(true);
    expect(calls.filter(c => c.batch.last).map(c => c.batch.seq)).toEqual([4]);
    expect(calls.every(c => c.batch.records.length <= 500)).toBe(true);
    expect(calls.find(c => c.batch.seq === 4)?.batch.records).toHaveLength(345);
    expect(calls.every(c => c.batch.txnType === 'APPEND')).toBe(true);
    expect(max()).toBeLessThanOrEqual(3);
    expect(max()).toBe(3);
    // presign url '' → no archive PUT.
    expect(putFile).not.toHaveBeenCalled();
    expect(progress.at(-1)).toMatchObject({
      phase: 'done',
      batchesDone: 5,
      batchesTotal: 5,
      archiveSkipped: true,
    });
  });

  it('PUTs the raw file when presign returns a URL', async () => {
    const {deps, putFile} = makeDeps({url: 'https://b2.example/put?sig=1'});
    const progress: UploadProgress[] = [];
    const p = runUpload(
      {sourceId: 'src-1', fileName: 'x.csv', file, batches: [rows(3)]},
      deps,
      s => progress.push(s),
    );
    await vi.runAllTimersAsync();
    expect((await p).archived).toBe(true);
    expect(putFile).toHaveBeenCalledWith(
      'https://b2.example/put?sig=1',
      file,
      expect.any(Function),
      undefined,
    );
    expect(progress.some(s => s.phase === 'archive' && s.archive === 0.5)).toBe(
      true,
    );
    expect(deps.presign).toHaveBeenCalledWith('src-1', 'x.csv', file.size);
  });

  it('retries a failing batch after 2 s, 4 s and 8 s with the same key', async () => {
    const {deps, calls, sleeps} = makeDeps({
      fail: (seq, attempt) =>
        seq === 1 && attempt < 3
          ? new ApiError({code: 'INTERNAL', status: 500})
          : null,
    });
    const p = runUpload(
      {
        sourceId: 's',
        fileName: 'x.csv',
        file,
        batches: planBatches(rows(1200)),
      },
      deps,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(calls.filter(c => c.batch.seq === 1)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1990);
    expect(calls.filter(c => c.batch.seq === 1)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(calls.filter(c => c.batch.seq === 1)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls.filter(c => c.batch.seq === 1)).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(8000);
    expect(calls.filter(c => c.batch.seq === 1)).toHaveLength(4);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toMatchObject({jobId: 'job-7'});
    expect(sleeps).toEqual([2000, 4000, 8000]);
    expect(
      new Set(calls.filter(c => c.batch.seq === 1).map(c => c.key)),
    ).toEqual(new Set(['job-7:1']));
  });

  it('gives up after 3 retries', async () => {
    const {deps, calls} = makeDeps({
      fail: seq =>
        seq === 0 ? new ApiError({code: 'NETWORK', status: 0}) : null,
    });
    const p = runUpload(
      {sourceId: 's', fileName: 'x.csv', file, batches: planBatches(rows(10))},
      deps,
    );
    const assertion = expect(p).rejects.toMatchObject({code: 'NETWORK'});
    await vi.runAllTimersAsync();
    await assertion;
    expect(calls).toHaveLength(4);
  });

  it('does not retry 4xx errors other than 429', async () => {
    const {deps, calls, sleeps} = makeDeps({
      fail: seq =>
        seq === 0
          ? new ApiError({code: 'VALIDATION_FAILED', status: 422})
          : null,
    });
    const p = runUpload(
      {sourceId: 's', fileName: 'x.csv', file, batches: [rows(2)]},
      deps,
    );
    const assertion = expect(p).rejects.toMatchObject({status: 422});
    await vi.runAllTimersAsync();
    await assertion;
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('honours retryAfter on 429', async () => {
    const {deps, calls, sleeps} = makeDeps({
      fail: (seq, attempt) =>
        seq === 0 && attempt === 0
          ? new ApiError({code: 'RATE_LIMITED', status: 429, retryAfter: 7})
          : null,
    });
    const p = runUpload(
      {sourceId: 's', fileName: 'x.csv', file, batches: [rows(2)]},
      deps,
    );
    await vi.runAllTimersAsync();
    await p;
    expect(sleeps).toEqual([7000]);
    expect(calls).toHaveLength(2);
  });
});

describe('planning helpers', () => {
  it('splits into ≤ 500-record batches', () => {
    expect(planBatches(rows(1001)).map(b => b.length)).toEqual([500, 500, 1]);
    expect(planBatches([])).toEqual([]);
  });

  it('estimates time from waves of 3 batches', () => {
    expect(estimateSeconds(3, 0, false)).toBe(1);
    expect(estimateSeconds(20, 0, false)).toBe(7);
  });
});
