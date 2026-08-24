/**
 * Admin-facing user-management resource.
 *
 * Mirrors the routes under {@code /api/admin/users/*}: list / create /
 * enable-disable / reset-password / delete. All endpoints require the
 * {@code admin} role.
 */
import {
  httpDelete,
  httpGet,
  httpPost,
  httpPut,
} from './client';
import type {
  ApiResponse,
  CreateUserDto,
  CredentialResult,
  PageQuery,
  PaginatedResponse,
  UserPublic,
} from '@ontodecide/shared';

/** Query params accepted by {@link list}. */
export type AdminUserListParams = PageQuery & { role?: string; q?: string };

/** {@code GET /api/admin/users} — paginated, optionally filtered. */
export async function list(
  params?: AdminUserListParams,
): Promise<ApiResponse<PaginatedResponse<UserPublic>>> {
  return httpGet<PaginatedResponse<UserPublic>>('/api/admin/users', params);
}

/** {@code POST /api/admin/users} — returns temporary credentials. */
export async function create(
  body: CreateUserDto,
): Promise<ApiResponse<CredentialResult>> {
  return httpPost<CredentialResult>('/api/admin/users', body);
}

/**
 * {@code PUT /api/admin/users/{id}/status}. Toggles {@code is_active}.
 */
export async function updateStatus(
  id: string,
  body: { is_active: boolean },
): Promise<ApiResponse<UserPublic>> {
  return httpPut<UserPublic>(
    `/api/admin/users/${encodeURIComponent(id)}/status`,
    body,
  );
}

/** {@code POST /api/admin/users/{id}/reset}. Returns a new temp password. */
export async function resetPassword(
  id: string,
): Promise<ApiResponse<CredentialResult>> {
  return httpPost<CredentialResult>(
    `/api/admin/users/${encodeURIComponent(id)}/reset`,
  );
}

/** {@code DELETE /api/admin/users/{id}}. */
export async function remove(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return httpDelete<{ success: boolean }>(
    `/api/admin/users/${encodeURIComponent(id)}`,
  );
}
