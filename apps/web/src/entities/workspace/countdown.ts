/**
 * @fileoverview Trial countdown of the signed-in owner (前端详细设计 6.3.2):
 * based on `workspace.trialExpiresAt` and the server clock skew; admins
 * (trialExpiresAt null) get no countdown. At zero the trial is re-checked
 * once (refresh) before going to /ended.
 */

import {useSession} from '../session/store';
import {recheckTrial} from '../session/lifecycle';
import {
  elapsedFraction,
  HOUR_MS,
  useRemaining,
} from '../../shared/lib/countdown';

/** Remaining ≤ 24 h shows the amber expiry banner. */
export const EXPIRY_BANNER_MS = 24 * HOUR_MS;

/** Trial countdown view model. */
export interface TrialCountdown {
  /** False for the admin (never expires) or before /me is known. */
  active: boolean;
  /** Epoch ms of the trial end. */
  expiresAt: number | null;
  /** Epoch ms of the e-mail verification (trial start). */
  startedAt: number | null;
  remainingMs: number;
  /** Elapsed fraction of the trial (0..1). */
  elapsed: number;
  /** ≤ 24 h left. */
  soon: boolean;
  timeZone: string;
}

function parse(v: string | null | undefined): number | null {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** Live trial countdown for the current session. */
export function useTrialCountdown(): TrialCountdown {
  const me = useSession(s => s.me);
  const role = useSession(s => s.role);
  const skew = useSession(s => s.clockSkewMs);
  const expiresAt =
    role === 'admin' ? null : parse(me?.workspace.trialExpiresAt ?? null);
  const startedAt = parse(me?.workspace.verifiedAt ?? null);
  const remaining = useRemaining(expiresAt, skew, () => {
    void recheckTrial();
  });
  const active = expiresAt !== null;
  return {
    active,
    expiresAt,
    startedAt,
    remainingMs: remaining,
    elapsed:
      active && startedAt !== null
        ? elapsedFraction(startedAt, expiresAt, Date.now(), skew)
        : 0,
    soon: active && remaining <= EXPIRY_BANNER_MS,
    timeZone: me?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
