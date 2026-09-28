/**
 * @fileoverview Session & client-global state (Zustand): in-memory access
 * token (never persisted), role from the token claims, the caller's account
 * and workspace (GET /me), the admin view target, and the server clock skew.
 * The UI is dark-only (修订说明书 11.1 #6).
 */

import type {MeDto} from '@ontodecide/identity/contract';
import type {AccessClaims, Quotas, UserRole} from '@ontodecide/shared-kernel';
import {base64urlDecode, fromUtf8} from '@ontodecide/shared-kernel';
import {create} from 'zustand';
import {readPrefs, writePrefs} from '../../shared/lib/prefs';

/** GET /me as returned by the gateway (identity part + quotas). */
export type Me = MeDto & {quotas?: Quotas};

/** Admin view target (Act-as-Tenant). */
export interface ActAsTarget {
  tenantId: string;
  email: string | null;
}

/** Session state. */
export interface SessionState {
  status: 'unknown' | 'authenticated' | 'anonymous';
  accessToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt?: number;
  /** Claims decoded (not verified) from the access token. */
  claims?: AccessClaims;
  role?: UserRole;
  me?: Me;
  actAs?: ActAsTarget;
  /** serverTime − localTime, from response Date headers. */
  clockSkewMs: number;
  /**
   * Admin only: server-time epoch ms when the 8-hour admin session ends,
   * started locally at sign-in. `me.sessionExpiresAt` wins when present
   * (see {@link adminSessionEnd}); this is the fallback.
   */
  adminSessionEndsAt?: number;
  /**
   * Admin session gate hit by a request (403 RECOVERY_PENDING /
   * PASSKEY_SETUP_INCOMPLETE); see {@link adminSetupNeeded}.
   */
  adminGate?: 'recovery' | 'setup';
  sidebarCollapsed: boolean;
  setAdminGate(gate: 'recovery' | 'setup' | undefined): void;
  setGrant(grant: {accessToken: string; expiresIn: number; me?: Me}): void;
  setMe(me: Me): void;
  signOut(): void;
  setActAs(target: ActAsTarget | undefined): void;
  setClockSkew(skewMs: number): void;
  setAdminSessionEndsAt(at: number | undefined): void;
  toggleSidebar(): void;
}

/** Decodes JWT claims without verifying (display and guards only). */
export function decodeClaims(token: string): AccessClaims | undefined {
  try {
    return JSON.parse(
      fromUtf8(base64urlDecode(token.split('.')[1] ?? '')),
    ) as AccessClaims;
  } catch {
    return undefined;
  }
}

const prefs = readPrefs();

/** Session store. */
export const useSession = create<SessionState>(set => ({
  status: 'unknown',
  clockSkewMs: 0,
  sidebarCollapsed: !!prefs.sidebarCollapsed,
  setGrant(grant) {
    const claims = decodeClaims(grant.accessToken);
    set(s => ({
      status: 'authenticated',
      accessToken: grant.accessToken,
      expiresAt: Date.now() + grant.expiresIn * 1000,
      claims,
      role: claims?.role,
      me: grant.me ?? s.me,
    }));
  },
  setMe(me) {
    set({me});
  },
  signOut() {
    set({
      status: 'anonymous',
      accessToken: undefined,
      expiresAt: undefined,
      claims: undefined,
      role: undefined,
      me: undefined,
      actAs: undefined,
      adminSessionEndsAt: undefined,
      adminGate: undefined,
    });
  },
  setAdminGate(gate) {
    set({adminGate: gate});
  },
  setActAs(target) {
    set({actAs: target});
  },
  setClockSkew(skewMs) {
    set({clockSkewMs: skewMs});
  },
  setAdminSessionEndsAt(at) {
    set({adminSessionEndsAt: at});
  },
  toggleSidebar() {
    set(s => {
      writePrefs({sidebarCollapsed: !s.sidebarCollapsed});
      return {sidebarCollapsed: !s.sidebarCollapsed};
    });
  },
}));

/** Current role (undefined when signed out). */
export function useRole(): UserRole | undefined {
  return useSession(s => s.role);
}

/** Whether the signed-in user is the admin. */
export function useIsAdmin(): boolean {
  return useSession(s => s.role === 'admin');
}

/** Server-corrected now (ms). */
export function serverNow(): number {
  return Date.now() + useSession.getState().clockSkewMs;
}

/**
 * Whether the admin must bind a passkey before anything else (前端详细设计
 * 6.3.7; 风险表 "首次登录流程可重入"):
 * - `recovery`: signed in with a recovery code (`me.recoveryPending`, or the
 *   gateway answered 403 RECOVERY_PENDING) — bind a new passkey, no step-up;
 * - `setup`: fewer than 2 passkeys or no recovery codes yet (or 403
 *   PASSKEY_SETUP_INCOMPLETE) — bind another one after a step-up.
 * null when nothing is required (and always for owners).
 */
export function adminSetupNeeded(
  s: Pick<SessionState, 'role' | 'me' | 'adminGate'>,
): 'recovery' | 'setup' | null {
  if (s.role !== 'admin') return null;
  if (s.me?.recoveryPending || s.adminGate === 'recovery') return 'recovery';
  const me = s.me;
  if (s.adminGate === 'setup') return 'setup';
  if (me && me.passkeys !== undefined && me.passkeys < 2) return 'setup';
  if (me && me.recoveryCodesLeft === 0) return 'setup';
  return null;
}

/**
 * When the admin session ends (server-time epoch ms): GET /me
 * `sessionExpiresAt` — which survives page reloads — else the local 8 h
 * timer started at sign-in. undefined for owners.
 */
export function adminSessionEnd(
  s: Pick<SessionState, 'role' | 'me' | 'adminSessionEndsAt'>,
): number | undefined {
  if (s.role !== 'admin') return undefined;
  const at = s.me?.sessionExpiresAt ? Date.parse(s.me.sessionExpiresAt) : NaN;
  return Number.isNaN(at) ? s.adminSessionEndsAt : at;
}

/**
 * Whether the locally known trial end has passed (corrected clock). The
 * admin never expires.
 */
export function trialKnownExpired(): boolean {
  const s = useSession.getState();
  if (s.role === 'admin') return false;
  const texp = s.me?.workspace.trialExpiresAt ?? null;
  if (texp) return Date.parse(texp) <= serverNow();
  return s.claims?.texp !== undefined && s.claims.texp * 1000 <= serverNow();
}
