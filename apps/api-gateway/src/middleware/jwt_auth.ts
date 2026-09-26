/**
 * @fileoverview Local HS256 access-token verification (kid rotation).
 * Role routes require `Authorization: Bearer`; WebSocket routes also accept
 * `?access_token=` because browsers cannot set headers on upgrades.
 */

import type {JwtClaims} from '@ontodecide/identity/contract';
import {AppError, isRole, verifyJwt} from '@ontodecide/shared-kernel';
import {type GatewayDeps, type Middleware, routeOf} from './chain';

/** Extracts the bearer token from an Authorization header. */
export function bearerToken(header: string | null): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m?.[1];
}

/** Verifies a token and checks the claims the gateway relies on. */
export async function verifyAccessToken(
  deps: GatewayDeps,
  token: string,
): Promise<JwtClaims> {
  const claims = await verifyJwt<JwtClaims>(
    token,
    deps.jwtKeys(),
    Math.floor(deps.now() / 1000),
  );
  if (
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    typeof claims.tid !== 'string' ||
    !claims.tid ||
    !isRole(claims.role)
  ) {
    throw new AppError('AUTH_INVALID', 'Invalid token claims');
  }
  return claims;
}

/** jwtAuth step. */
export function jwtAuth(deps: GatewayDeps): Middleware {
  return async (s, next) => {
    const route = routeOf(s);
    const access = route.minRole;
    if (access === 'public' || access === 'cookie' || access === 'hmac') {
      return next();
    }
    let token = bearerToken(s.request.headers.get('authorization'));
    if (!token && route.websocket) {
      token = s.url.searchParams.get('access_token') ?? undefined;
    }
    if (!token) throw new AppError('AUTH_INVALID', 'Missing bearer token');
    s.claims = await verifyAccessToken(deps, token);
    return next();
  };
}
