/**
 * Situation-view resource (Graph service).
 *
 * Mirrors {@code GET /api/situation/{id}} which returns the enriched
 * {@link SituationNode} for the given entity id (same shape as the more
 * specific {@code /api/entities/{id}} endpoint, but kept separate for
 * routing clarity with the Gateway's explicit situation prefix).
 */
import { httpGet } from './client';
import type { ApiResponse, SituationNode } from '@ontodecide/shared';

/** {@code GET /api/situation/{id}}. */
export async function get(
  id: string,
): Promise<ApiResponse<SituationNode>> {
  return httpGet<SituationNode>(
    `/api/situation/${encodeURIComponent(id)}`,
  );
}
