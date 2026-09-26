/**
 * @fileoverview Recommendation state machine (建议状态机).
 *
 * Draft → Proposed | Failed | Expired
 * Proposed → Approved | Rejected | Expired
 * Approved → Executed | ExecFailed
 * Executed → Evaluated
 *
 * `Draft → Expired` is an addition to the design diagram so the daily cron
 * can retire drafts whose generation job never completed.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {RecStatus} from '../contract';

/** Allowed transitions. */
export const REC_TRANSITIONS: Readonly<
  Record<RecStatus, readonly RecStatus[]>
> = {
  Draft: ['Proposed', 'Failed', 'Expired'],
  Proposed: ['Approved', 'Rejected', 'Expired'],
  Approved: ['Executed', 'ExecFailed'],
  Executed: ['Evaluated'],
  Rejected: [],
  Expired: [],
  ExecFailed: [],
  Evaluated: [],
  Failed: [],
};

/** Whether `from → to` is allowed. */
export function canTransition(from: RecStatus, to: RecStatus): boolean {
  return REC_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Returns `to`, or throws INVALID_TRANSITION. */
export function transition(from: RecStatus, to: RecStatus): RecStatus {
  if (!canTransition(from, to)) {
    throw new AppError('INVALID_TRANSITION', `${from} → ${to} is not allowed`, {
      from,
      to,
    });
  }
  return to;
}

/** Whether the status is terminal. */
export function isTerminal(status: RecStatus): boolean {
  return REC_TRANSITIONS[status].length === 0;
}
