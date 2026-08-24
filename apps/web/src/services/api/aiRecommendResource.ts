/**
 * AI recommendation resource.
 *
 * Generates a single structured recommendation for a topic, optionally
 * grounded in a recent decision history string.
 */
import { httpPost } from './client';
import type {
  ApiResponse,
  Recommendation,
  RecommendationRequestDto,
} from '@ontodecide/shared';

/** {@code POST /api/ai/recommend}. */
export async function generate(
  body: RecommendationRequestDto,
): Promise<ApiResponse<Recommendation>> {
  return httpPost<Recommendation>('/api/ai/recommend', body);
}
