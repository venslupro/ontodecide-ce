/**
 * Admin audit-log resource.
 *
 * Covers {@code GET /api/admin/audit} — paginated list of audit log rows
 * (admin-only). Returns the raw shared {@link AuditLogRow} rows.
 */
import { httpGet } from './client';
import type {
  ApiResponse,
  AuditLogRow,
  PageQuery,
  PaginatedResponse,
} from '@ontodecide/shared';

/** {@code GET /api/admin/audit}. */
export async function list(
  params?: PageQuery,
): Promise<ApiResponse<PaginatedResponse<AuditLogRow>>> {
  return httpGet<PaginatedResponse<AuditLogRow>>('/api/admin/audit', params);
}
