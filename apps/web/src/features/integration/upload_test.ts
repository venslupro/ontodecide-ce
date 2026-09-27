/**
 * @fileoverview Upload runner: batches ≤ 100 rows, sequential seq with
 * `last`, 512 KB body halving (planned and after a 413), idempotent retry
 * of the same seq (2 s / 4 s / 8 s), no retry of other 4xx, QUOTA_EXCEEDED
 * stops, job reuse, resume and abort.
 */

import type {
  BatchInput,
  BatchResult,
  JobDto,
  MappingSpec,
  Row,
} from '@ontodecide/integration/contract';
import {describe, expect, it, vi} from 'vitest';
import {ApiError} from '../../shared/api/errors';
import {
  batchBodyBytes,
  newUploadState,
  planBatches,
  RETRY_DELAYS_MS,
  RowTooLargeError,
  runUpload,
  UploadAbortedError,
  type UploadDeps,
} from './upload';

const MAPPING: MappingSpec = {
  targetType: 'Supplier',
  primaryKey: {from: 'k'},
  fields: [{to: 'supplierId', from: 'k'}],
};

function rows(n: number, pad = 0): Row[] {
  return Array.from({length: n}, (_, i) => ({k: `S-${i}`, p: 'x'.repeat(pad)}));
}

const JOB: JobDto = {
  id: 'imp-1',
  kind: 'file',
  fileName: 'a.csv',
  targetType: 'Supplier',
  mapping: null,
  status: 'RECEIVING',
  totalRows: 0,
  received: 0,
  upserted: 0,
  skipped: 0,
  rejected: 0,
  createdAt: '',
  updatedAt: '',
};

function fakeDeps(
  onBatch?: (b: BatchInput, call: number) => BatchResult | Error,
) {
  const batches: BatchInput[] = [];
  const sleeps: number[] = [];
  let call = 0;
  const deps: UploadDeps = {
    createImport: vi.fn(async input => ({...JOB, totalRows: input.totalRows})),
    putMapping: vi.fn(async () => JOB),
    submitBatch: vi.fn(
      async (_id: string, b: BatchInput): Promise<BatchResult> => {
        batches.push(b);
        const out = onBatch?.(b, call++);
        if (out instanceof Error) throw out;
        return (
          out ?? {
            seq: b.seq,
            upserted: b.rows.length - 1,
            skipped: 0,
            rejected: [{row: 1, code: 'REQUIRED'}],
            job: {
              status: 'RECEIVING' as const,
              received: 0,
              upserted: 0,
              skipped: 0,
              rejected: 0,
            },
          }
        );
      },
    ),
    getImport: vi.fn(async () => ({...JOB, status: 'DONE' as const})),
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
    }),
  };
  return {deps, batches, sleeps};
}

describe('planBatches', () => {
  it('chunks by 100 rows', () => {
    expect(
      planBatches(rows(212)).map(b => [b.firstRow, b.rows.length]),
    ).toEqual([
      [1, 100],
      [101, 100],
      [201, 12],
    ]);
  });

  it('halves recursively until each body is ≤ the byte limit', () => {
    const r = rows(100, 6000); // ≈ 600 KB per 100 rows
    const plan = planBatches(r);
    expect(plan.map(b => b.rows.length)).toEqual([50, 50]);
    for (const b of plan)
      expect(batchBodyBytes(b.rows)).toBeLessThanOrEqual(512 * 1024);
    const tight = planBatches(rows(8, 100), {maxRows: 100, maxBytes: 400});
    expect(tight.map(b => b.rows.length)).toEqual([2, 2, 2, 2]);
    expect(tight.map(b => b.firstRow)).toEqual([1, 3, 5, 7]);
  });

  it('fails when a single row cannot fit', () => {
    expect(() =>
      planBatches(rows(1, 1000), {maxRows: 100, maxBytes: 100}),
    ).toThrow(RowTooLargeError);
  });
});

describe('runUpload', () => {
  it('creates the job, sets the mapping and sends batches in order', async () => {
    const {deps, batches} = fakeDeps();
    const progress: number[] = [];
    const job = await runUpload(
      {fileName: 'a.csv', mapping: MAPPING, rows: rows(250)},
      deps,
      newUploadState(),
      {onProgress: p => progress.push(p.batchesDone)},
    );
    expect(deps.createImport).toHaveBeenCalledWith({
      fileName: 'a.csv',
      targetType: 'Supplier',
      totalRows: 250,
    });
    expect(deps.putMapping).toHaveBeenCalledWith('imp-1', MAPPING);
    expect(batches.map(b => [b.seq, b.last, b.rows.length])).toEqual([
      [0, false, 100],
      [1, false, 100],
      [2, true, 50],
    ]);
    expect(progress.at(-1)).toBe(3);
    expect(job.status).toBe('DONE');
  });

  it('reuses the job created for the AI draft and accumulates progress', async () => {
    const {deps} = fakeDeps();
    const state = newUploadState('imp-draft');
    await runUpload(
      {fileName: 'a.csv', mapping: MAPPING, rows: rows(120)},
      deps,
      state,
    );
    expect(deps.createImport).not.toHaveBeenCalled();
    expect(deps.putMapping).toHaveBeenCalledWith('imp-draft', MAPPING);
    expect(state.progress).toMatchObject({
      batchesDone: 2,
      rowsSent: 120,
      upserted: 118,
      rejected: 2,
    });
  });

  it('retries the same seq after 2 s and 4 s', async () => {
    const {deps, batches, sleeps} = fakeDeps((b, call) =>
      b.seq === 1 && call < 3
        ? new ApiError({code: 'INTERNAL', status: 503})
        : undefined!,
    );
    await runUpload(
      {fileName: 'a', mapping: MAPPING, rows: rows(250)},
      deps,
      newUploadState(),
    );
    expect(batches.map(b => b.seq)).toEqual([0, 1, 1, 1, 2]);
    expect(sleeps).toEqual([2000, 4000]);
  });

  it('gives up after 3 retries and resumes from the failed seq', async () => {
    let fail = true;
    const {deps, batches, sleeps} = fakeDeps(b =>
      fail && b.seq === 1
        ? new ApiError({code: 'NETWORK', status: 0})
        : undefined!,
    );
    const state = newUploadState();
    const input = {fileName: 'a', mapping: MAPPING, rows: rows(250)};
    await expect(runUpload(input, deps, state)).rejects.toMatchObject({
      code: 'NETWORK',
    });
    expect(sleeps).toEqual([...RETRY_DELAYS_MS]);
    expect(state.next).toBe(1);
    fail = false;
    await runUpload(input, deps, state);
    expect(deps.createImport).toHaveBeenCalledTimes(1);
    expect(deps.putMapping).toHaveBeenCalledTimes(1);
    expect(batches.map(b => b.seq)).toEqual([0, 1, 1, 1, 1, 1, 2]);
  });

  it('waits Retry-After for RATE_LIMITED', async () => {
    const {deps, sleeps} = fakeDeps((_b, call) =>
      call === 0
        ? new ApiError({code: 'RATE_LIMITED', status: 429, retryAfter: 5})
        : undefined!,
    );
    await runUpload(
      {fileName: 'a', mapping: MAPPING, rows: rows(10)},
      deps,
      newUploadState(),
    );
    expect(sleeps).toEqual([5000]);
  });

  it('stops on QUOTA_EXCEEDED and on other 4xx without retrying', async () => {
    for (const err of [
      new ApiError({code: 'QUOTA_EXCEEDED', status: 429}),
      new ApiError({code: 'VALIDATION_FAILED', status: 400}),
    ]) {
      const {deps, batches, sleeps} = fakeDeps(() => err);
      await expect(
        runUpload(
          {fileName: 'a', mapping: MAPPING, rows: rows(150)},
          deps,
          newUploadState(),
        ),
      ).rejects.toBe(err);
      expect(batches).toHaveLength(1);
      expect(sleeps).toEqual([]);
    }
  });

  it('halves a batch after a 413, renumbering later seqs', async () => {
    const {deps, batches} = fakeDeps(b =>
      b.seq === 0 && b.rows.length === 100
        ? new ApiError({code: 'VALIDATION_FAILED', status: 413})
        : undefined!,
    );
    await runUpload(
      {fileName: 'a', mapping: MAPPING, rows: rows(150)},
      deps,
      newUploadState(),
    );
    expect(batches.map(b => [b.seq, b.rows.length, b.last])).toEqual([
      [0, 100, false],
      [0, 50, false],
      [1, 50, false],
      [2, 50, true],
    ]);
  });

  it('aborts between batches', async () => {
    const ctrl = new AbortController();
    const {deps, batches} = fakeDeps(b => {
      if (b.seq === 0) ctrl.abort();
      return undefined!;
    });
    await expect(
      runUpload(
        {fileName: 'a', mapping: MAPPING, rows: rows(250)},
        deps,
        newUploadState(),
        {
          signal: ctrl.signal,
        },
      ),
    ).rejects.toBeInstanceOf(UploadAbortedError);
    expect(batches).toHaveLength(1);
    expect(deps.getImport).not.toHaveBeenCalled();
  });
});
