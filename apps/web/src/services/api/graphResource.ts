/**
 * Graph query resource (Graph service).
 *
 * Covers the two graph-level endpoints: {@code POST /api/graph/explore}
 * (first/second-hop exploration rooted at a single entity, analyst-level
 * access) and {@code POST /api/graph/query} (admin-only Cypher).
 */
import { httpPost } from './client';
import type {
  ApiResponse,
  CypherQueryRequest,
  ExploreRequest,
  SituationNode,
} from '@ontodecide/shared';

/** {@code POST /api/graph/explore}. */
export async function explore(
  body: ExploreRequest,
): Promise<ApiResponse<SituationNode[]>> {
  return httpPost<SituationNode[]>('/api/graph/explore', body);
}

/**
 * {@code POST /api/graph/query} — admin-only. Returns rows as an array of
 * arbitrary objects since Cypher projections are user-defined.
 */
export async function cypher(
  body: CypherQueryRequest,
): Promise<ApiResponse<Array<Record<string, unknown>>>> {
  return httpPost<Array<Record<string, unknown>>>(
    '/api/graph/query',
    body,
  );
}
