/**
 * @fileoverview Login / refresh / logout: the refresh token only ever
 * travels in the HttpOnly `od_refresh` cookie, never in a response body.
 */

import type {TokenPair} from '@ontodecide/identity/contract';
import {AppError} from '@ontodecide/shared-kernel';
import {clearRefreshCookie, readRefreshCookie, refreshCookie} from './cookies';
import type {Env} from './env';
import {jsonResponse, problemResponse} from './http';
import type {HandlerInput} from './route_types';

/** Whether the refresh cookie carries `Secure`. */
export function cookieSecure(env: Env): boolean {
  return env.COOKIE_SECURE !== 'false';
}

function tokenResponse(env: Env, pair: TokenPair): Response {
  return jsonResponse(
    {accessToken: pair.accessToken, expiresIn: pair.expiresIn, user: pair.user},
    200,
    {'set-cookie': refreshCookie(pair.refreshToken, cookieSecure(env))},
  );
}

/** POST /auth/login. */
export async function login(
  env: Env,
  input: HandlerInput<{email: string; password: string}>,
): Promise<Response> {
  const pair = await env.IDENTITY.login(input.body);
  return tokenResponse(env, pair);
}

/** POST /auth/refresh: rotates the cookie; clears it when rejected. */
export async function refresh(
  env: Env,
  input: HandlerInput,
): Promise<Response> {
  const token = readRefreshCookie(input.headers);
  if (!token) throw new AppError('AUTH_INVALID', 'Missing refresh cookie');
  try {
    const pair = await env.IDENTITY.refresh(token);
    return tokenResponse(env, pair);
  } catch (err) {
    const e = AppError.from(err);
    if (e.status !== 401) throw err;
    return problemResponse(e, input.ctx.requestId, {
      'set-cookie': clearRefreshCookie(cookieSecure(env)),
    });
  }
}

/** POST /auth/logout: best-effort revoke, always clears the cookie. */
export async function logout(env: Env, input: HandlerInput): Promise<Response> {
  const token = readRefreshCookie(input.headers);
  if (token) {
    try {
      await env.IDENTITY.logout(token);
    } catch (err) {
      input.logger.warn('logout.revoke_failed', {
        requestId: input.ctx.requestId,
        code: AppError.from(err).code,
      });
    }
  }
  return new Response(null, {
    status: 204,
    headers: {'set-cookie': clearRefreshCookie(cookieSecure(env))},
  });
}
