/**
 * @fileoverview 429 RATE_LIMITED handling (前端详细设计 6.3.1 限流 / 6.6):
 * the buttons of the action that got it enter a Retry-After countdown and
 * re-enable at zero. QUOTA_EXCEEDED is not handled here (it stays inline
 * next to the action with the reset time, never retried automatically).
 *
 * Countdowns are keyed by action (e.g. `auth.code`, `decision`,
 * `action:<id>`, `import.batch`) in a module store, so closing and
 * reopening a dialog keeps the wait.
 */

import {useCallback, useSyncExternalStore} from 'react';
import {useCountdown} from '../lib/hooks';
import {isApiError} from './errors';

/** Wait used when a 429 carries no Retry-After header. */
export const DEFAULT_RETRY_AFTER_S = 10;
/** Upper bound for a single wait (defensive against bad headers). */
export const MAX_RETRY_AFTER_S = 3600;

const until = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/**
 * Starts the countdown of `key` when `err` is a 429 RATE_LIMITED; returns
 * whether it was one (the caller then skips its generic error message or
 * shows {@link rateLimitMessage}).
 */
export function trapRateLimit(
  key: string,
  err: unknown,
  now = Date.now(),
): boolean {
  if (!isApiError(err, 'RATE_LIMITED')) return false;
  const s = Math.min(
    MAX_RETRY_AFTER_S,
    Math.max(1, Math.ceil(err.retryAfter ?? DEFAULT_RETRY_AFTER_S)),
  );
  until.set(key, now + s * 1000);
  notify();
  return true;
}

/** Epoch ms when `key` may retry (null: not limited). */
export function rateLimitedUntil(key: string): number | null {
  return until.get(key) ?? null;
}

/** Clears every countdown (tests, sign-out). */
export function resetRateLimits(): void {
  until.clear();
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** State of one rate-limited action. */
export interface RetryAfterState {
  /** Seconds left (0: allowed). */
  seconds: number;
  /** Whether the action's buttons must stay disabled. */
  limited: boolean;
  /** {@link trapRateLimit} bound to this action. */
  trap(err: unknown): boolean;
}

/** Countdown of one action key; re-renders every second while limited. */
export function useRetryAfter(key: string): RetryAfterState {
  const at = useSyncExternalStore(
    subscribe,
    () => rateLimitedUntil(key),
    () => null,
  );
  const seconds = useCountdown(at);
  const trap = useCallback((err: unknown) => trapRateLimit(key, err), [key]);
  return {seconds, limited: seconds > 0, trap};
}
