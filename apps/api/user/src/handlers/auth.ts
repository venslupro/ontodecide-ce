/**
 * Authentication HTTP handlers.
 *
 * Routes handled here (see design doc §4.1):
 *   POST /auth/login           — username + password → access + refresh tokens
 *   POST /auth/refresh          — refresh token → new access + refresh tokens
 *   POST /auth/logout           — revoke current refresh token
 *   POST /auth/change-password  — first-login activation (change temp password)
 *
 * All handlers return the standard {@link ApiResponse} envelope.
 */
import type {Context} from 'hono';
import {
  CONFIG,
  ERROR_CODES,
  HEADERS,
  fail,
  nowEpochSeconds,
  ok,
  signJwt,
  throwError,
  uuid,
  verifyJwt,
} from '@ontodecide/shared';
import type {JwtPayload} from '@ontodecide/shared';
import type {UserManagementService} from '../service/user.service.js';
import type {AuditContext} from '../service/user.service.js';
import {PWD_CHANGE_TOKEN_TTL_SECONDS} from '../service/user.service.js';

/** Build the access-token JWT payload for a logged-in user. */
function buildPayload(
    userId: string,
    tenantId: string,
    username: string,
    role: JwtPayload['role'],
    jti: string,
    ttlSeconds: number = CONFIG.ACCESS_TOKEN_TTL_SECONDS,
    pwdChangeRequired?: boolean,
): Omit<JwtPayload, 'iat'> {
  const now = nowEpochSeconds();
  return {
    user_id: userId,
    tenant_id: tenantId,
    username,
    role,
    exp: now + ttlSeconds,
    jti,
    pwd_change_required: pwdChangeRequired,
  };
}

/** Build audit context from Hono Context (identity headers set by Gateway). */
function auditFromContext(c: Context): AuditContext {
  return {
    operatorId: c.req.header(HEADERS.USER_ID) ?? 'anon',
    operatorTenantId: c.req.header(HEADERS.TENANT_ID) ?? 'tenant_anon',
    ip: c.req.header('cf-connecting-ip') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  };
}

/** POST /auth/login */
export async function loginHandler(
    c: Context,
    jwtSecret: string,
    service: UserManagementService,
) {
  const body = await c.req.json();
  if (!body?.username || !body?.password) {
    return c.json(
        fail(ERROR_CODES.VALIDATION_FAILED,
            'username and password are required.'),
        400,
    );
  }
  const ctx = auditFromContext(c);
  const user = await service.login(body.username, body.password, ctx);

  // When the user must change their password (first login with temp
  // password), issue a short-lived activation-only token. No refresh
  // token is issued until the password is changed.
  if (user.requiresPasswordChange) {
    const accessJti = uuid();
    const payload = buildPayload(
        user.id, user.tenantId, user.username, user.role, accessJti,
        PWD_CHANGE_TOKEN_TTL_SECONDS, true);
    const accessToken = await signJwt(payload, jwtSecret);
    return c.json(ok({
      accessToken,
      refreshToken: null,
      expiresIn: PWD_CHANGE_TOKEN_TTL_SECONDS,
      requirePasswordChange: true,
    }, c.req.header(HEADERS.TRACE_ID)), 200);
  }

  const accessJti = uuid();
  const payload = buildPayload(
      user.id, user.tenantId, user.username, user.role, accessJti);
  const accessToken = await signJwt(payload, jwtSecret);
  const {jti: refreshJti} = await service.issueRefreshToken(user);
  const refreshPayload = buildPayload(
      user.id, user.tenantId, user.username, user.role, refreshJti);
  refreshPayload.exp = nowEpochSeconds() + CONFIG.REFRESH_TOKEN_TTL_SECONDS;
  const refreshToken = await signJwt(refreshPayload, jwtSecret);
  return c.json(ok({
    accessToken,
    refreshToken,
    expiresIn: CONFIG.ACCESS_TOKEN_TTL_SECONDS,
  }, c.req.header(HEADERS.TRACE_ID)), 200);
}

/** POST /auth/refresh */
export async function refreshHandler(
    c: Context,
    jwtSecret: string,
    service: UserManagementService,
) {
  const body = await c.req.json();
  if (!body?.refreshToken) {
    return c.json(
        fail(ERROR_CODES.VALIDATION_FAILED, 'refreshToken is required.'),
        400,
    );
  }
  const payload = await verifyJwt(body.refreshToken, jwtSecret);
  if (!payload) {
    return c.json(
        fail(ERROR_CODES.AUTH_TOKEN_EXPIRED,
            'Refresh token invalid or expired.'),
        401,
    );
  }
  await service.revokeRefreshToken(payload.jti);
  const user = await service.getUser(payload.user_id);
  const accessJti = uuid();
  const accessPayload = buildPayload(
      user.id, user.tenantId, user.username, user.role, accessJti);
  const accessToken = await signJwt(accessPayload, jwtSecret);
  const {jti: refreshJti} = await service.issueRefreshToken(user);
  const refreshPayload = buildPayload(
      user.id, user.tenantId, user.username, user.role, refreshJti);
  refreshPayload.exp = nowEpochSeconds() + CONFIG.REFRESH_TOKEN_TTL_SECONDS;
  const refreshToken = await signJwt(refreshPayload, jwtSecret);
  return c.json(ok({
    accessToken,
    refreshToken,
    expiresIn: CONFIG.ACCESS_TOKEN_TTL_SECONDS,
  }, c.req.header(HEADERS.TRACE_ID)), 200);
}

/** POST /auth/logout */
export async function logoutHandler(
    c: Context,
    jwtSecret: string,
    service: UserManagementService,
) {
  const body = await c.req.json().catch(() => ({}));
  if (body?.refreshToken) {
    const payload = await verifyJwt(body.refreshToken, jwtSecret);
    if (payload) {
      await service.revokeRefreshToken(payload.jti);
    }
  }
  return c.json(ok({success: true}, c.req.header(HEADERS.TRACE_ID)), 200);
}

/**
 * POST /auth/change-password
 *
 * Self-service password change used for first-login activation.
 * Requires a valid access token (with `pwd_change_required: true`).
 */
export async function changePasswordHandler(
    c: Context,
    jwtSecret: string,
    service: UserManagementService,
) {
  const body = await c.req.json();
  if (!body?.currentPassword || !body?.newPassword) {
    return c.json(
        fail(ERROR_CODES.VALIDATION_FAILED,
            'currentPassword and newPassword are required.'),
        400,
    );
  }
  if (body.newPassword.length < 8) {
    return c.json(
        fail(ERROR_CODES.VALIDATION_FAILED,
            'New password must be at least 8 characters.'),
        400,
    );
  }
  const userId = c.req.header(HEADERS.USER_ID);
  if (!userId) {
    return c.json(
        fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing identity headers.'),
        403,
    );
  }
  const ctx = auditFromContext(c);
  const user = await service.changePassword(
      userId, body.currentPassword, body.newPassword, ctx);

  // Issue full tokens after successful password change.
  const accessJti = uuid();
  const payload = buildPayload(
      user.id, user.tenantId, user.username, user.role, accessJti);
  const accessToken = await signJwt(payload, jwtSecret);
  const {jti: refreshJti} = await service.issueRefreshToken(user);
  const refreshPayload = buildPayload(
      user.id, user.tenantId, user.username, user.role, refreshJti);
  refreshPayload.exp = nowEpochSeconds() + CONFIG.REFRESH_TOKEN_TTL_SECONDS;
  const refreshToken = await signJwt(refreshPayload, jwtSecret);
  return c.json(ok({
    accessToken,
    refreshToken,
    expiresIn: CONFIG.ACCESS_TOKEN_TTL_SECONDS,
  }, c.req.header(HEADERS.TRACE_ID)), 200);
}

export {throwError};
