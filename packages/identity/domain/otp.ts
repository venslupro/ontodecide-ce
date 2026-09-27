/**
 * @fileoverview One-time e-mail code rules (详细设计 6.3.5, 6.7): 6 digits,
 * 10 minutes, ≤ 5 attempts per code, ≤ 5 sends per e-mail per day, 10
 * failures per day lock the e-mail for 24 hours, 60 s resend throttle.
 */

import {DAY_MS, MINUTE_MS} from '@ontodecide/shared-kernel';

/** Code limits. */
export const OTP = {
  digits: 6,
  ttlMs: 10 * MINUTE_MS,
  /** Pending codes are removed 30 minutes after issue. */
  retentionMs: 30 * MINUTE_MS,
  resendThrottleMs: 60_000,
  maxAttemptsPerCode: 5,
  maxSendsPerDay: 5,
  maxFailuresPerDay: 10,
  lockMs: DAY_MS,
} as const;

/** Code purposes stored in pending_code. */
export type CodePurpose = 'signup' | 'login' | 'terminate';

/**
 * Generates a uniformly distributed 6-digit code from a random source
 * (rejection sampling avoids modulo bias).
 */
export function generateCode(
  random: (n: number) => Uint8Array = n =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const limit = 4_294_000_000; // largest multiple of 1e6 below 2^32
  for (;;) {
    const b = random(4);
    const v = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    if (v < limit) return String(v % 1_000_000).padStart(OTP.digits, '0');
  }
}

/** When the code was issued, derived from its expiry. */
export function issuedAt(expiresAt: number): number {
  return expiresAt - OTP.ttlMs;
}

/** Whether a new code may be sent (60 s throttle per e-mail and purpose). */
export function canResend(
  existingExpiresAt: number | null,
  now: number,
): boolean {
  if (existingExpiresAt === null) return true;
  return now - issuedAt(existingExpiresAt) >= OTP.resendThrottleMs;
}

/** Outcome of a failed attempt. */
export interface FailureOutcome {
  /** Delete the pending code (its 5th failure). */
  dropCode: boolean;
  /** Lock the e-mail until this instant (10th failure of the day). */
  lockUntil: number | null;
}

/** Decides what a wrong code does, given counts after incrementing. */
export function onFailure(
  codeAttempts: number,
  dayFailures: number,
  now: number,
): FailureOutcome {
  return {
    dropCode: codeAttempts >= OTP.maxAttemptsPerCode,
    lockUntil: dayFailures >= OTP.maxFailuresPerDay ? now + OTP.lockMs : null,
  };
}
