/**
 * @fileoverview Splits a batch of records into queue-sized chunks
 * (≤ 50 records and ≤ 120 KB per ingest message, envelope included).
 */

import {AppError, jsonBytes} from '@ontodecide/shared-kernel';
import {INGEST_LIMITS} from '../contract';

/** One chunk and the index of its first record within the input. */
export interface RecordChunk<T = Record<string, unknown>> {
  offset: number;
  records: T[];
}

/** Splitting limits. */
export interface SplitLimits {
  maxRecords?: number;
  maxBytes?: number;
  /** Bytes reserved for the message envelope (ctx, ids). */
  envelopeBytes?: number;
}

/** Default envelope reservation for an IngestMsg. */
export const INGEST_ENVELOPE_BYTES = 2048;

/**
 * Greedily packs records into chunks. A single record that cannot fit in a
 * message on its own throws BATCH_TOO_LARGE.
 */
export function splitRecords<T extends object = Record<string, unknown>>(
  records: readonly T[],
  limits: SplitLimits = {},
): RecordChunk<T>[] {
  const maxRecords = limits.maxRecords ?? INGEST_LIMITS.messageRecordsMax;
  const maxBytes = limits.maxBytes ?? INGEST_LIMITS.messageBytesMax;
  const budget = maxBytes - (limits.envelopeBytes ?? INGEST_ENVELOPE_BYTES);
  const chunks: RecordChunk<T>[] = [];
  let current: RecordChunk<T> | null = null;
  // `[` + `]` plus one comma per additional record.
  let bytes = 2;
  records.forEach((r, i) => {
    const size = jsonBytes(r);
    if (size + 2 > budget) {
      throw new AppError(
        'BATCH_TOO_LARGE',
        `Record ${i} is ${size} bytes; a message holds at most ${budget} bytes`,
      );
    }
    const extra = current && current.records.length > 0 ? size + 1 : size;
    if (
      !current ||
      current.records.length >= maxRecords ||
      bytes + extra > budget
    ) {
      current = {offset: i, records: []};
      chunks.push(current);
      bytes = 2;
    }
    bytes += current.records.length > 0 ? size + 1 : size;
    current.records.push(r);
  });
  return chunks;
}
