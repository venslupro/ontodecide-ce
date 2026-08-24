/**
 * AI scenario simulation resource.
 *
 * Mirrors {@code POST /api/ai/scenario} which generates 3-point scenarios
 * (optimistic / pessimistic / neutral) for a topic.
 */
import { httpPost } from './client';
import type {
  ApiResponse,
  ScenarioRequestDto,
  ScenarioResult,
} from '@ontodecide/shared';

/** {@code POST /api/ai/scenario}. */
export async function generate(
  body: ScenarioRequestDto,
): Promise<ApiResponse<ScenarioResult>> {
  return httpPost<ScenarioResult>('/api/ai/scenario', body);
}
