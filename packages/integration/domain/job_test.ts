/**
 * @fileoverview Tests for the job model.
 */

import {describe, expect, it} from 'vitest';
import {
  applyDelta,
  effectiveStatus,
  rejectedRows,
  STALE_JOB_MS,
  toJobDto,
} from './job';
import type {JobRecord} from './job';

const JOB: JobRecord = {
  id: 'J1',
  kind: 'file',
  fileName: 'a.csv',
  targetType: 'Supplier',
  mapping: null,
  status: 'RECEIVING',
  totalRows: 10,
  received: 0,
  upserted: 0,
  skipped: 0,
  rejected: 0,
  createdAt: 0,
  updatedAt: 1000,
};

describe('job', () => {
  it('reads a stale RECEIVING job as FAILED', () => {
    expect(effectiveStatus(JOB, 1000 + STALE_JOB_MS)).toBe('RECEIVING');
    expect(effectiveStatus(JOB, 1001 + STALE_JOB_MS)).toBe('FAILED');
    expect(effectiveStatus({...JOB, status: 'DONE'}, 1e12)).toBe('DONE');
  });

  it('applies deltas and completes on last', () => {
    const d = {received: 5, upserted: 3, skipped: 1, rejected: 1};
    const a = applyDelta(JOB, d, false, 2000);
    expect(a).toMatchObject({received: 5, upserted: 3, status: 'RECEIVING'});
    const b = applyDelta(a, d, true, 3000);
    expect(b).toMatchObject({received: 10, rejected: 2, status: 'DONE'});
    expect(b.updatedAt).toBe(3000);
  });

  it('renders DTOs', () => {
    const dto = toJobDto(JOB, 2000, []);
    expect(dto.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(dto.rejects).toEqual([]);
    expect('rejects' in toJobDto(JOB, 2000)).toBe(false);
  });

  it('counts distinct rejected rows', () => {
    expect(
      rejectedRows([
        {row: 1, code: 'A'},
        {row: 1, code: 'B'},
        {row: 2, code: 'A'},
      ]),
    ).toBe(2);
  });
});
