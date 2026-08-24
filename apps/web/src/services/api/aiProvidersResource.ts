/**
 * AI providers resource (AI service).
 *
 * Covers {@code GET /api/ai/providers} which lists the LLM provider ids
 * the deployment has credentials for. Values map onto {@link LlmProvider}.
 */
import { httpGet } from './client';
import type { ApiResponse, LlmProvider } from '@ontodecide/shared';

/** {@code GET /api/ai/providers}. */
export async function list(): Promise<ApiResponse<LlmProvider[]>> {
  return httpGet<LlmProvider[]>('/api/ai/providers');
}
