/**
 * @fileoverview Account lock policy: consecutive login failures lock the
 * account for a fixed period; a successful login resets the counter.
 */

/** Consecutive failures that lock an account. */
export const MAX_FAILED_ATTEMPTS = 5;

/** How long a locked account stays locked (15 minutes). */
export const LOCK_DURATION_MS = 15 * 60_000;

/** Lock-relevant state of an account. */
export interface LockState {
  failedAttempts: number;
  /** Epoch ms until which the account is locked, or null. */
  lockedUntil: number | null;
}

/** Whether the account is locked at `now` (epoch ms). */
export function isLocked(state: LockState, now: number): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now;
}

/**
 * Applies a failed attempt. An expired lock starts a fresh window; the
 * {@link MAX_FAILED_ATTEMPTS}-th consecutive failure locks the account.
 */
export function applyFailure(state: LockState, now: number): LockState {
  const expired = state.lockedUntil !== null && state.lockedUntil <= now;
  const failedAttempts = (expired ? 0 : state.failedAttempts) + 1;
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    return {failedAttempts, lockedUntil: now + LOCK_DURATION_MS};
  }
  return {failedAttempts, lockedUntil: expired ? null : state.lockedUntil};
}

/** State after a successful login (or an admin reset). */
export function applySuccess(): LockState {
  return {failedAttempts: 0, lockedUntil: null};
}
