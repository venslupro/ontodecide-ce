/**
 * @fileoverview PlatformAdmin: system_flag keys and thresholds of the cron
 * health checks shown on the platform overview (B2 signing-key age).
 * Keys hold no personal data and never the key id itself (only a hash).
 */

import {DAY_MS, sha256Hex} from '@ontodecide/shared-kernel';

/** system_flag key prefix: first time a B2 signing key id was seen. */
export const SIGN_KEY_FLAG_PREFIX = 'b2_sign_key:';

/** A signing key older than this should be rotated (修订说明书 9.6: monthly). */
export const SIGN_KEY_MAX_AGE_MS = 30 * DAY_MS;

/** The signing-key check runs every this many cron ticks (2 min each). */
export const SIGN_KEY_CHECK_EVERY = 12;

/** Cron tick length (identity-access `*\/2 * * * *`). */
export const CRON_TICK_MS = 2 * 60_000;

/** system_flag key of a signing key id (hashed). */
export async function signKeyFlag(keyId: string): Promise<string> {
  return `${SIGN_KEY_FLAG_PREFIX}${(await sha256Hex(`b2:${keyId}`)).slice(0, 32)}`;
}

/** Whether `now` falls on a signing-key check tick (every 12th tick). */
export function isSignKeyTick(now: Date): boolean {
  return Math.floor(now.getTime() / CRON_TICK_MS) % SIGN_KEY_CHECK_EVERY === 0;
}

/** Whether a key first seen at `firstSeenAt` is due for rotation. */
export function signKeyRotationDue(firstSeenAt: number, now: number): boolean {
  return now - firstSeenAt > SIGN_KEY_MAX_AGE_MS;
}
