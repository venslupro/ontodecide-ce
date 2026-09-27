/**
 * @fileoverview Token steps for `workspace` and `admin` routes:
 *
 * 1. {@link verifyToken}: Ed25519 signature, kid and exp (401
 *    UNAUTHENTICATED); owners with `texp ≤ now` or `st ≠ ACTIVE` → 401
 *    TRIAL_EXPIRED (the admin has no trial and is never expired).
 * 2. {@link adminSession}: every admin token is checked against
 *    `IDENTITY.verifyAdminSession(sid)` so revocation is immediate.
 * 3. {@link scopeCheck}: `admin` routes need role admin and `amr` ⊇
 *    passkey (403 otherwise; owners → 403).
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

/** Admin session step: `IDENTITY.verifyAdminSession(sid)` on every request. */
export function adminSession(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    if (s.claims?.role === 'admin') {
      const ok = await deps.env.IDENTITY.verifyAdminSession(s.claims.sid);
      if (!ok) throw new AppError('UNAUTHENTICATED', 'Admin session revoked');
    }
    return next();
  };
}

/** Scope / role step. */
export function scopeCheck(): Middleware {
  return async (s, next) => {
    if (s.scope === 'admin') {
      const c = s.claims;
      const factor =
        c?.amr.includes('passkey') ||
        (!!s.route?.recoveryOk && !!c?.amr.includes('recovery'));
      if (!c || c.role !== 'admin' || !factor) {
        throw new AppError('FORBIDDEN', 'Admin with passkey required');
      }
    }
    return next();
  };
}
