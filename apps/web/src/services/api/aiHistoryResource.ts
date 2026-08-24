/**
 * AI decision-history resource.
 *
 * Covers {@code GET /api/ai/history} which returns a paginated list of
 * prior scenario / recommendation outputs (AI service, authenticated).
 */
import { httpGet } from './client';
import type {
  ApiResponse,
  PageQuery,
  PaginatedResponse,
  Recommendation,
  ScenarioResult,
} from '@ontodecide/shared';

/** Unified history row returned by the list endpoint. */
export type HistoryRecord =
  | ({ kind: 'scenario' } & ScenarioResult)
  | ({ kind: 'recommendation' } & Recommendation);

/** {@code GET /api/ai/history} — paginated list. */
export async function list(
  params?: PageQuery,
): Promise<ApiResponse<PaginatedResponse<HistoryRecord>>> {
  return httpGet<PaginatedResponse<HistoryRecord>>(
    '/api/ai/history',
    params,
  );
}
