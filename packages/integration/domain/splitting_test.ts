/**
 * @fileoverview Tests for message splitting.
 */

import {AppError, jsonBytes} from '@ontodecide/shared-kernel';
import {describe, expect, it} from 'vitest';
import {INGEST_ENVELOPE_BYTES, splitRecords} from './splitting';

describe('splitRecords', () => {
  it('splits by record count (≤ 50)', () => {
    const records = Array.from({length: 120}, (_, i) => ({id: i}));
    const chunks = splitRecords(records);
    expect(chunks.map(c => c.records.length)).toEqual([50, 50, 20]);
    expect(chunks.map(c => c.offset)).toEqual([0, 50, 100]);
  });

  it('splits by bytes (≤ 120 KB including the envelope)', () => {
    const blob = 'x'.repeat(10 * 1024);
    const records = Array.from({length: 30}, (_, i) => ({id: i, blob}));
    const chunks = splitRecords(records);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(jsonBytes(c.records) + INGEST_ENVELOPE_BYTES).toBeLessThanOrEqual(
        120 * 1024,
      );
      expect(c.records.length).toBeLessThanOrEqual(50);
    }
    expect(chunks.reduce((n, c) => n + c.records.length, 0)).toBe(30);
  });

  it('rejects a single oversized record', () => {
    expect(() => splitRecords([{blob: 'x'.repeat(130 * 1024)}])).toThrow(
      AppError,
    );
  });

  it('returns no chunks for no records', () => {
    expect(splitRecords([])).toEqual([]);
  });
});
