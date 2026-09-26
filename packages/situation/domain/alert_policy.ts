/**
 * @fileoverview Alert de-duplication and cooldown. At most one OPEN alert
 * exists per (automation, rid) (also enforced by a partial unique index).
 * Hits while OPEN/ACKED update the snapshot and hit count. After CLOSED,
 * hits within the cooldown only update the latest alert and trigger
 * nothing; later hits raise a new alert that fires the rule's effects.
 */

import type {AlertStatus} from '../contract';

/** The latest alert of an (automation, rid) pair. */
export interface LatestAlert {
  id: string;
  status: AlertStatus;
  /** Epoch ms; set when CLOSED. */
  closedAt?: number | null;
}

/** What to do with a rule hit. */
export type AlertDecision =
  | {kind: 'create'}
  | {kind: 'update'; alertId: string; reason: 'active' | 'cooldown'};

/** Decides how a rule hit is recorded. */
export function decideAlert(
  latest: LatestAlert | null,
  nowMs: number,
  cooldownSec: number,
): AlertDecision {
  if (!latest) return {kind: 'create'};
  if (latest.status !== 'CLOSED') {
    return {kind: 'update', alertId: latest.id, reason: 'active'};
  }
  const closedAt = latest.closedAt ?? 0;
  if (nowMs - closedAt < cooldownSec * 1000) {
    return {kind: 'update', alertId: latest.id, reason: 'cooldown'};
  }
  return {kind: 'create'};
}

/** Severity rank (higher = more severe). */
export const SEVERITY_RANK = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
} as const;

/** Allowed manual status transitions. */
export function canTransition(from: AlertStatus, to: AlertStatus): boolean {
  if (from === to) return from !== 'CLOSED';
  if (from === 'OPEN') return to === 'ACKED' || to === 'CLOSED';
  if (from === 'ACKED') return to === 'CLOSED';
  return false;
}
