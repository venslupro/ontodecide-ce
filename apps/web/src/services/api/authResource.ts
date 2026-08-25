/**
 * Auth resource module.
 *
 * Mirrors the {@code /api/auth/*} routes registered by the Gateway. The
 * login + refresh endpoints are public (no Bearer header required until
 * the caller has a session).
 */
import {
  httpPost,
} from './client';
import type {
  ApiResponse,
  AuthTokens,
  LoginDto,
  RefreshDto,
} from '@ontodecide/shared';

/** {@code POST /api/auth/login} — public. */
export async function login(
  body: LoginDto,
): Promise<ApiResponse<AuthTokens>> {
  return httpPost<AuthTokens>('/api/auth/login', body);
}

/** {@code POST /api/auth/refresh} — public. */
export async function refresh(
  body: RefreshDto,
): Promise<ApiResponse<AuthTokens>> {
  return httpPost<AuthTokens>('/api/auth/refresh', body);
}

/** {@code POST /api/auth/logout} — authenticated. */
export async function logout(): Promise<ApiResponse<{ success: boolean }>> {
  return httpPost<{ success: boolean }>('/api/auth/logout');
}

/**
 * {@code POST /api/auth/change-password}. Requires authentication, and on
 * success returns fresh tokens because a password change cycles the JWT.
 */
export async function changePassword(body: {
  currentPassword: string;
  newPassword: string;
}): Promise<ApiResponse<AuthTokens>> {
  return httpPost<AuthTokens>('/api/auth/change-password', body);
}
