/**
 * Authentication middleware: extracts and verifies the Bearer JWT, then
 * enriches the Hono context with the user identity.
 *
 * The underlying `authenticate` function is framework-agnostic so it can be
 * unit-tested without a Hono pipeline. The `authMiddleware` Hono handler
 * wraps it and stores the result in `c.var.auth`.
 */
import type {MiddlewareHandler} from 'hono';
import {
  CACHE_KEYS,
  ERROR_CODES,
  JwtPayload,
  HEADERS,
  uuid,
  verifyJwt,
} from '@ontodecide/shared';
import {jsonFailResponse} from '@ontodecide/shared/hono';
import type {GatewayEnv} from '../types/env.js';
import {PUBLIC_PREFIXES, ADMIN_PREFIXES} from '../routes.js';

export interface AuthContext {
  payload: JwtPayload;
  traceId: string;
}

export interface AuthFailure {
  code: string;
  message: string;
  status: number;
}

/**
 * Verify the request's Bearer token.
 *
 * @returns The decoded payload on success, or a failure descriptor when
 *   verification fails or the token has been revoked via the KV blacklist.
 */
export async function authenticate(
    request: Request,
    env: GatewayEnv,
    traceId: string,
): Promise<{ok: true; ctx: AuthContext} | {ok: false; failure: AuthFailure}> {
  const authHeader = request.headers.get(HEADERS.AUTHORIZATION) ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) {
    return {
      ok: false,
      failure: {
        code: ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Missing or malformed Authorization header.',
        status: 401,
      },
    };
  }
  const token = match[1];
  const payload = await verifyJwt(token, env.JWT_SECRET, async (jti) => {
    const value = await env.JWT_BLACKLIST.get(CACHE_KEYS.jwtBlacklist(jti));
    return value !== null;
  });
  if (!payload) {
    return {
      ok: false,
      failure: {
        code: ERROR_CODES.AUTH_TOKEN_EXPIRED,
        message: 'Token is invalid, expired, or revoked.',
        status: 401,
      },
    };
  }
  return {ok: true, ctx: {payload, traceId}};
}

/** True when the path is allowed without authentication. */
export function isPublicPath(pathname: string, publicPrefixes: readonly string[]): boolean {
  return publicPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname === p);
}

/** True when the path requires the `admin` role. */
export function isAdminPath(pathname: string, adminPrefixes: readonly string[]): boolean {
  return adminPrefixes.some((p) => pathname.startsWith(p));
}

/** True when the caller's role satisfies the admin requirement. */
export function authorizeAdmin(payload: JwtPayload): boolean {
  return payload.role === 'admin';
}

/** Hono context variables shared between middleware and route handlers. */
export interface GatewayVariables {
  /** Auth context set by `authMiddleware`, read by rate-limit + forward. */
  auth: AuthContext;
}

/** Build a synthetic auth context for public routes (login, refresh). */
function syntheticAuth(traceId: string): AuthContext {
  return {
    payload: {
      user_id: 'anon',
      tenant_id: 'anon',
      username: 'anon',
      role: 'viewer',
      exp: 0,
      iat: 0,
      jti: 'anon',
    },
    traceId,
  };
}

/**
 * Hono middleware that verifies the Bearer JWT (or allows public routes),
 * then stores the {@link AuthContext} in `c.var.auth` for downstream
 * middleware and the forward handler.
 */
export const authMiddleware: MiddlewareHandler<{
  Bindings: GatewayEnv;
  Variables: GatewayVariables;
}> = async (c, next) => {
  const traceId = c.req.header(HEADERS.TRACE_ID) ?? uuid();
  const path = new URL(c.req.url).pathname;

  if (isPublicPath(path, PUBLIC_PREFIXES)) {
    c.set('auth', syntheticAuth(traceId));
    await next();
    return;
  }

  const result = await authenticate(c.req.raw, c.env, traceId);
  if (!result.ok) {
    return jsonFailResponse(
        c,
        result.failure.code,
        result.failure.message,
        result.failure.status,
    );
  }
  c.set('auth', result.ctx);

  if (isAdminPath(path, ADMIN_PREFIXES) && !authorizeAdmin(result.ctx.payload)) {
    return jsonFailResponse(
        c,
        ERROR_CODES.AUTH_FORBIDDEN,
        'Admin role required.',
        403,
    );
  }

  await next();
  return;
};
