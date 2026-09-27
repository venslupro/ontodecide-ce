/**
 * @fileoverview Alert dedupe and cooldown (详细设计 6.3.4 告警去重与冷却).
 *
 * At most one active (OPEN or ACKED) alert per (automation, rid); the
 * partial unique index on OPEN rows backs this up in storage. A hit within
 * `cooldownSec` after an alert closed only updates that alert's snapshot and
 * hit count. An active alert closes as soon as its condition stops holding.
 */

import type {AlertStatus, Severity} from '../contract/types';

/** Minimal alert view used by the policy. */
export interface AlertState {
  id: string;
  status: AlertStatus;
  /** Unix ms; null unless CLOSED. */
  closedAt: number | null;
}

/** What to do with one (automation, object) pair. */
export type AlertDecision =
  | {kind: 'raise'}
  | {kind: 'hit'; alertId: string}
  | {kind: 'cooldown'; alertId: string}
  | {kind: 'close'; alertId: string}
  | {kind: 'none'};

/** Inputs of {@link decideAlert}. */
export interface AlertPolicyInput {
  /** Whether the automation condition holds for the object now. */
  matches: boolean;
  /** The OPEN / ACKED alert of the pair, if any. */
  active: AlertState | null;
  /** The most recently closed alert of the pair, if any. */
  lastClosed: AlertState | null;
  cooldownSec: number;
  now: number;
}

/** Decides how an evaluation result changes the alerts of one pair. */
export function decideAlert(input: AlertPolicyInput): AlertDecision {
  const {matches, active, lastClosed, cooldownSec, now} = input;
  if (!matches) {
    return active ? {kind: 'close', alertId: active.id} : {kind: 'none'};
  }
  if (active) return {kind: 'hit', alertId: active.id};
  if (
    lastClosed !== null &&
    lastClosed.closedAt !== null &&
    now < lastClosed.closedAt + cooldownSec * 1000
  ) {
    return {kind: 'cooldown', alertId: lastClosed.id};
  }
  return {kind: 'raise'};
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/** Numeric severity rank (higher is more severe). */
export function severityRank(s: Severity): number {
  return SEVERITY_RANK[s] ?? 0;
}
