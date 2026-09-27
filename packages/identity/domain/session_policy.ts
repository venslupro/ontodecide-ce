/**
 * @fileoverview Session and token lifetimes (修订说明书 5.4, 详细设计 6.7).
 */

import {HOUR_MS, MINUTE_MS, type UserRole} from '@ontodecide/shared-kernel';

/** Token lifetimes. */
export const TOKEN_TTL = {
  /** Access token, seconds (15 min). */
  accessS: 900,
  /** Admin pre-authentication token after the e-mail code, seconds. */
  preAuthS: 300,
  /** Step-up proof after a passkey user verification, seconds. */
  stepUpS: 300,
  /** WebAuthn challenge, ms. */
  challengeMs: 5 * MINUTE_MS,
} as const;

/** Inputs of a session expiry computation. */
export interface SessionExpiryInput {
  role: UserRole;
  now: number;
  /** Trial end (owners). */
  trialExpiresAt: number | null;
  trialHours: number;
  adminSessionHours: number;
}

/**
 * Owner: min(login + trial hours (72 h), trial end); admin: login + 8 h.
 */
export function sessionExpiry(i: SessionExpiryInput): number {
  if (i.role === 'admin') return i.now + i.adminSessionHours * HOUR_MS;
  const cap = i.now + i.trialHours * HOUR_MS;
  return i.trialExpiresAt === null ? cap : Math.min(cap, i.trialExpiresAt);
}

/** Whether a workspace lets its owner hold a session right now. */
export function trialUsable(
  status: string,
  trialExpiresAt: number | null,
  now: number,
): boolean {
  return (
    status === 'ACTIVE' && (trialExpiresAt === null || trialExpiresAt > now)
  );
}
