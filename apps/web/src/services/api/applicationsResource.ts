/**
 * Public account application resource.
 *
 * Mirrors {@code POST /api/applications} — anonymous users submit this
 * form to request a tenant. Rate-limited on the Gateway.
 */
import { httpPost } from './client';
import type { ApiResponse } from '@ontodecide/shared';

/** Response envelope returned for a successful application. */
export interface ApplicationResult {
  /** True when the application was accepted (auto-approved). */
  success?: boolean;
  /** Optional message shown to the applicant. */
  message?: string;
}

/** {@code POST /api/applications} — public, rate-limited. */
export async function submit(body: {
  email: string;
  name?: string;
  reason?: string;
}): Promise<ApiResponse<ApplicationResult>> {
  return httpPost<ApplicationResult>('/api/applications', body);
}
