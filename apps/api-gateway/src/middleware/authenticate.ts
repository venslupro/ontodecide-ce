/**
 * @fileoverview Token steps for `workspace` and `admin` routes:
 *
 * 1. {@link verifyToken}: Ed25519 signature, kid and exp (401
 *    UNAUTHENTICATED); owners with `texp ≤ now` or `st ≠ ACTIVE` → 401
 *    TRIAL_EXPIRED (the admin has no trial and is never expired).
 * 2. {@link adminSession}: every admin token is checked against
 *    `IDENTITY.adminSessionStatus(sid)` so revocation is immediate, and the
 *    session gate applies (403 FORBIDDEN, extras.reason):
 *    - RECOVERY_PENDING: a recovery-code session that has not bound a new
 *      passkey reaches only {@link RECOVERY_OPS} (every other route,
 *      business routes with or without X-Act-As-Tenant included, is 403);
 *    - PASSKEY_SETUP_INCOMPLETE: while the admin has fewer than 2 passkeys
 *      (or no recovery codes yet) only {@link SETUP_OPS} work.
 *    Binding the passkey upgrades the session row to amr otp + passkey; the
 *    live session state (not the token's amr) decides, and the next refresh
 *    issues an otp + passkey token.
 * 3. {@link scopeCheck}: `admin` routes need role admin and `amr` ⊇
 *    passkey or recovery (the session gate above restricts recovery; 403
 *    otherwise; owners → 403).
 */

import {
  AppError,
  isUserRole,
  verifyJwt,
  type AccessClaims,
} from '@ontodecide/shared-kernel';
import type {GatewayDeps, GatewayState, Middleware} from './chain';

function needsToken(s: GatewayState): boolean {
  return s.scope === 'workspace' || s.scope === 'admin';
}

function bearer(req: Request): string | undefined {
  const h = req.headers.get('authorization');
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h.trim()) : null;
  return m?.[1];
}

function checkShape(c: AccessClaims): void {
  // Pre-auth and step-up tokens share the signing key but carry `typ`; only
  // access tokens (no `typ`) may authenticate a request.
  const ok =
    (c as {typ?: unknown}).typ === undefined &&
    typeof c.sub === 'string' &&
    typeof c.tid === 'string' &&
    typeof c.sid === 'string' &&
    isUserRole(c.role) &&
    Array.isArray(c.amr);
  if (!ok) throw new AppError('UNAUTHENTICATED', 'Malformed claims');
}

/** Ed25519 verification step. */
export function verifyToken(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    if (!needsToken(s)) return next();
    const token = bearer(s.request);
    if (!token) throw new AppError('UNAUTHENTICATED', 'Missing bearer token');
    const nowSec = Math.floor(deps.clock.now().getTime() / 1000);
    const claims = await verifyJwt<AccessClaims>(
      token,
      deps.publicKeys(),
      nowSec,
    );
    checkShape(claims);
    if (claims.role === 'owner' && !s.route?.allowExpired) {
      if (typeof claims.texp !== 'number') {
        throw new AppError('UNAUTHENTICATED', 'Owner token without texp');
      }
      if (claims.texp <= nowSec || claims.st !== 'ACTIVE') {
        throw new AppError('TRIAL_EXPIRED');
      }
    }
    s.claims = claims;
    return next();
  };
}

/**
 * Operations a recovery-code session may call before it binds a passkey:
 * GET /me, GET /admin/passkeys, POST /admin/passkeys/options,
 * POST /admin/passkeys and logout.
 */
export const RECOVERY_OPS: ReadonlySet<string> = new Set([
  'getMe',
  'logout',
  'adminListPasskeys',
  'adminPasskeyOptions',
  'adminAddPasskey',
]);

/**
 * Operations allowed while the admin has fewer than 2 passkeys: the above
 * plus the step-up that the second passkey's registration needs.
 */
export const SETUP_OPS: ReadonlySet<string> = new Set([
  ...RECOVERY_OPS,
  'passkeyOptions',
  'passkeyAssertion',
]);

function gateError(reason: string): AppError {
  return new AppError('FORBIDDEN', reason, {extras: {reason}});
}

/**
 * Admin session step: `IDENTITY.adminSessionStatus(sid)` on every request
 * with an admin token, then the recovery / passkey-setup gate.
 */
export function adminSession(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    if (s.claims?.role === 'admin') {
      const st = await deps.env.IDENTITY.adminSessionStatus(s.claims.sid);
      if (!st?.valid) {
        throw new AppError('UNAUTHENTICATED', 'Admin session revoked');
      }
      s.adminStatus = st;
      const op = s.route?.op ?? '';
      if (st.recoveryPending && !RECOVERY_OPS.has(op)) {
        throw gateError('RECOVERY_PENDING');
      }
      if (st.setupIncomplete && !SETUP_OPS.has(op)) {
        throw gateError('PASSKEY_SETUP_INCOMPLETE');
      }
    }
    return next();
  };
}

/** Scope / role step. */
export function scopeCheck(): Middleware {
  return async (s, next) => {
    if (s.scope === 'admin') {
      const c = s.claims;
      // A recovery token passes only through the session gate above: while
      // pending it reaches RECOVERY_OPS, once upgraded the session counts
      // as a passkey session.
      const factor =
        !!c?.amr.includes('passkey') || !!c?.amr.includes('recovery');
      if (!c || c.role !== 'admin' || !factor || !s.adminStatus?.valid) {
        throw new AppError('FORBIDDEN', 'Admin with passkey required');
      }
    }
    return next();
  };
}
