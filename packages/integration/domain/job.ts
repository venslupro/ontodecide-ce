/**
 * @fileoverview Ingestion job (Dataset transaction) state machine and the
 * completion rule.
 *
 * A job is complete only when (1) the batch flagged `last` was submitted and
 * every batch `0..lastSeq` was recorded, (2) every ingest message was
 * processed and (3) every object-writes group was reported. The counters
 * are idempotent (deduplicated per batch / message / group), so the rule is
 * robust to out-of-order delivery, retries and duplicates: whoever updates
 * the last counter observes completion.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {JobStatus} from '../contract';

/** Allowed transitions. */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  Queued: ['Running', 'Succeeded', 'PartiallyFailed', 'Failed'],
  Running: ['Succeeded', 'PartiallyFailed', 'Failed'],
  Succeeded: [],
  PartiallyFailed: [],
  Failed: [],
};

/** Whether the status is terminal. */
export function isTerminal(status: JobStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Whether `from → to` is allowed. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws INVALID_TRANSITION unless `from → to` is allowed. */
export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      'INVALID_TRANSITION',
      `Job cannot go from ${from} to ${to}`,
    );
  }
}

/** Progress counters of a job. */
export interface JobCounters {
  received: number;
  rejected: number;
  /** Seq of the batch flagged `last`, or null while more batches may come. */
  lastSeq: number | null;
  /** Distinct batches recorded. */
  batches: number;
  ingestTotal: number;
  ingestDone: number;
  totalGroups: number;
  doneGroups: number;
}

/** Whether every part of the job has been processed. */
export function isJobComplete(c: JobCounters): boolean {
  return (
    c.lastSeq !== null &&
    c.batches >= c.lastSeq + 1 &&
    c.ingestDone >= c.ingestTotal &&
    c.doneGroups >= c.totalGroups
  );
}

/** accepted / received (1 when nothing was received). */
export function qualityScore(received: number, rejected: number): number {
  if (received <= 0) return 1;
  const accepted = Math.max(0, received - rejected);
  return Math.round((accepted / received) * 10_000) / 10_000;
}

/** Terminal status from the counters. */
export function finalStatus(
  c: Pick<JobCounters, 'received' | 'rejected'>,
): JobStatus {
  if (c.rejected <= 0) return 'Succeeded';
  if (c.rejected >= c.received) return 'Failed';
  return 'PartiallyFailed';
}

/** Ingest message seq for record chunk `n` of client batch `batchSeq`. */
export function ingestSeq(batchSeq: number, n: number): number {
  return batchSeq * 1000 + n;
}

/** Object-writes groups one ingest message may produce (byte overflow). */
export const GROUPS_PER_MESSAGE = 64;

/** Object-writes seq of group `k` produced by ingest message `seq`. */
export function groupSeq(ingestMsgSeq: number, k: number): number {
  return ingestMsgSeq * GROUPS_PER_MESSAGE + k;
}

/** Row number (1-based, within the job) of a batch record. */
export function batchRowOffset(batchSeq: number, batchSize: number): number {
  return batchSeq * batchSize + 1;
}
