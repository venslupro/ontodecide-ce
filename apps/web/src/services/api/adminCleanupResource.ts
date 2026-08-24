/**
 * Admin cleanup-run resource.
 *
 * Mirrors the two cleanup routes served by the Cleanup service:
 * {@code POST /api/admin/cleanup} and {@code GET
 * /api/admin/cleanup/status/{taskId}}. Both require the admin role.
 */
import { httpGet, httpPost } from './client';
import type {
  ApiResponse,
  CleanupRequestDto,
  CleanupStatusDto,
} from '@ontodecide/shared';

/** {@code POST /api/admin/cleanup} — trigger a new cleanup run. */
export async function trigger(
  body: CleanupRequestDto,
): Promise<ApiResponse<CleanupStatusDto>> {
  return httpPost<CleanupStatusDto>('/api/admin/cleanup', body);
}

/** {@code GET /api/admin/cleanup/status/{taskId}}. */
export async function getStatus(
  taskId: string,
): Promise<ApiResponse<CleanupStatusDto>> {
  return httpGet<CleanupStatusDto>(
    `/api/admin/cleanup/status/${encodeURIComponent(taskId)}`,
  );
}
