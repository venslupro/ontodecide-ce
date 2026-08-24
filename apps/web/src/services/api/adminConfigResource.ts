/**
 * Admin system-configuration resource.
 *
 * Mirrors {@code GET /api/admin/config} (list) and {@code PUT
 * /api/admin/config} (upsert a single key/value pair). Admin-only.
 */
import { httpGet, httpPut } from './client';
import type { ApiResponse } from '@ontodecide/shared';

/** A single configuration row returned by the backend. */
export interface ConfigEntry {
  key: string;
  value: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** {@code GET /api/admin/config} — list all config entries. */
export async function list(): Promise<ApiResponse<ConfigEntry[]>> {
  return httpGet<ConfigEntry[]>('/api/admin/config');
}

/** {@code PUT /api/admin/config} — upsert a single config key/value. */
export async function update(body: {
  key: string;
  value: string;
}): Promise<ApiResponse<ConfigEntry>> {
  return httpPut<ConfigEntry>('/api/admin/config', body);
}
