/**
 * @fileoverview Session endpoints: the gateway turns `refreshToken` into
 * the `__Host-od_rt` cookie (set on issue, rotated on refresh, cleared on
 * logout) and never returns it in a body.
 */

import type {
  IssuedSession,
  PasskeyRegistered,
  SessionResult,
  StepUpToken,
} from '@ontodecide/identity/contract';
import {AppError, type Clock} from '@ontodecide/shared-kernel';
import {clearRefreshCookie, readRefreshCookie, refreshCookie} from './cookies';
import {empty, json} from './http';
import type {RouteHandler} from './route_types';

/** Body of an issued session (no refresh token). */
export function sessionBody(s: IssuedSession): Record<string, unknown> {
  return {accessToken: s.accessToken, expiresIn: s.expiresIn, me: s.me};
}

/** 201 session response with the refresh cookie. */
export function sessionResponse(
  s: IssuedSession,
  clock: Clock,
  extra: Record<string, unknown> = {},
): Response {
  return json({...extra, ...sessionBody(s)}, 201, {
    'set-cookie': refreshCookie(
      s.refreshToken,
      s.refreshExpiresAt,
      clock.now().getTime(),
    ),
  });
}

/** Maps a SessionResult to its HTTP response. */
export function sessionResultResponse(
  r: SessionResult,
  clock: Clock,
): Response {
  if (r.kind === 'session') return sessionResponse(r, clock);
  return json(
    {passkeyRequired: true, preAuth: r.preAuth, setupRequired: r.setupRequired},
    200,
  );
}

/** Maps a passkey assertion result (session or step-up token). */
export function assertionResponse(
  r: IssuedSession | StepUpToken,
  clock: Clock,
): Response {
  if ('kind' in r && r.kind === 'session') return sessionResponse(r, clock);
  const t = r as StepUpToken;
  return json({stepUpToken: t.stepUpToken, expiresIn: t.expiresIn}, 200);
}

/** Maps the first-passkey setup result (it carries the admin session). */
export function setupResponse(r: PasskeyRegistered, clock: Clock): Response {
  const extra = {
    passkey: r.passkey,
    total: r.total,
    ...(r.recoveryCodes ? {recoveryCodes: r.recoveryCodes} : {}),
  };
  if (!r.session) return json(extra, 201);
  return sessionResponse(r.session, clock, extra);
}

/** POST /auth/sessions/refresh. */
export const refreshHandler: RouteHandler = async (env, input) => {
  const token = readRefreshCookie(input.request.headers);
  if (!token) throw new AppError('UNAUTHENTICATED', 'No refresh cookie');
  const r = await env.IDENTITY.refresh(token, input.meta);
  return json({accessToken: r.accessToken, expiresIn: r.expiresIn}, 200, {
    'set-cookie': refreshCookie(
      r.refreshToken,
      r.refreshExpiresAt,
      input.clock.now().getTime(),
    ),
  });
};

/** DELETE /auth/sessions/current. */
export const logoutHandler: RouteHandler = async (env, input) => {
  await env.IDENTITY.logout(input.ctx!, input.claims!.sid);
  return empty(204, {'set-cookie': clearRefreshCookie()});
};
