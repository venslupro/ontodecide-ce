/**
 * Self-service user resource.
 *
 * Covers {@code GET /api/user/profile} which returns the current caller's
 * {@link UserPublic} row (password hashes and credentials are stripped).
 */
import { httpGet } from './client';
import type { ApiResponse, UserPublic } from '@ontodecide/shared';

/** {@code GET /api/user/profile} — authenticated (any role). */
export async function getProfile(): Promise<ApiResponse<UserPublic>> {
  return httpGet<UserPublic>('/api/user/profile');
}
