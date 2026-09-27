/**
 * @fileoverview Trial workspace lifecycle and sign-up admission (修订说明书
 * 7.3, 8, 9.2; 详细设计 6.11.6). States: ACTIVE → EXPIRED → ARCHIVING; the
 * row is deleted with the account. ARCHIVE_ONLY is derived for the admin UI.
 */

import {
  HOUR_MS,
  MINUTE_MS,
  type WorkspaceStatus,
} from '@ontodecide/shared-kernel';

/** Maximum successful sign-ups per IP (HMAC) per UTC day. */
export const SIGNUPS_PER_IP_DAILY = 2;

/** Reminder after verification (T + 48 h). */
export const REMINDER_AFTER_MS = 48 * HOUR_MS;

/** Read-only admission snapshot taken before a sign-up code is sent. */
export interface AdmissionSnapshot {
  signupEnabled: boolean;
  signupDailyLimit: number;
  signupsToday: number;
  activeWorkspaceLimit: number;
  activeTrials: number;
  purgeBacklog: number;
  purgeBacklogLimit: number;
  /** usage_counter(day, signup_closed) = 1 (hourly analytics ≥ 80 %). */
  autoClosed: boolean;
  signupsFromIpToday: number;
}

/** Why sign-up is closed (never shown verbatim; always SIGNUP_CLOSED). */
export type AdmissionRefusal =
  | 'paused'
  | 'daily_limit'
  | 'active_limit'
  | 'purge_backlog'
  | 'auto_closed'
  | 'ip_limit';

/** Evaluates the admission pre-check; null means admitted. */
export function admissionRefusal(
  s: AdmissionSnapshot,
): AdmissionRefusal | null {
  if (!s.signupEnabled) return 'paused';
  if (s.autoClosed) return 'auto_closed';
  if (s.signupsToday >= s.signupDailyLimit) return 'daily_limit';
  if (s.activeTrials >= s.activeWorkspaceLimit) return 'active_limit';
  if (s.purgeBacklog >= s.purgeBacklogLimit) return 'purge_backlog';
  if (s.signupsFromIpToday >= SIGNUPS_PER_IP_DAILY) return 'ip_limit';
  return null;
}

/** Sign-up state shown on the platform overview. */
export function signupState(
  enabled: boolean,
  autoClosed: boolean,
): 'open' | 'paused' | 'auto_closed' {
  if (!enabled) return 'paused';
  return autoClosed ? 'auto_closed' : 'open';
}

/** Whether archiving may start (all issued access tokens have expired). */
export function archiveDue(
  expiredAt: number,
  now: number,
  delayMin: number,
): boolean {
  return now >= expiredAt + delayMin * MINUTE_MS;
}

/** Whether a status is a stored workspace status. */
export function isWorkspaceStatus(s: string): s is WorkspaceStatus {
  return s === 'ACTIVE' || s === 'EXPIRED' || s === 'ARCHIVING';
}
