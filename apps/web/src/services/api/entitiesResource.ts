/**
 * Entity resource (Graph service).
 *
 * Covers search, lookup, upsert, and delete for graph entities. The
 * {@code get} endpoint returns a {@link SituationNode} (entity + first-hop
 * relations) instead of a plain {@link EntityNode}.
 */
import {
  httpDelete,
  httpGet,
  httpPost,
} from './client';
import type {
  ApiResponse,
  EntityNode,
  IngestPayload,
  PageQuery,
  SituationNode,
} from '@ontodecide/shared';

/** Query params accepted by {@link find}. */
export type EntityListParams = PageQuery & {
  type?: string;
  q?: string;
};

/** {@code GET /api/entities} — paginated list with optional filters. */
export async function find(
  params?: EntityListParams,
): Promise<ApiResponse<EntityNode[]>> {
  return httpGet<EntityNode[]>('/api/entities', params);
}

/**
 * {@code POST /api/entities} — upsert a batch of entities + their edges.
 * Payload shape matches {@link IngestPayload}.
 */
export async function upsert(
  body: IngestPayload,
): Promise<ApiResponse<{ success: boolean }>> {
  return httpPost<{ success: boolean }>('/api/entities', body);
}

/** {@code GET /api/entities/{id}} — single entity plus relations. */
export async function get(
  id: string,
): Promise<ApiResponse<SituationNode>> {
  return httpGet<SituationNode>(
    `/api/entities/${encodeURIComponent(id)}`,
  );
}

/** {@code DELETE /api/entities/{id}}. */
export async function remove(
  id: string,
): Promise<ApiResponse<{ success: boolean }>> {
  return httpDelete<{ success: boolean }>(
    `/api/entities/${encodeURIComponent(id)}`,
  );
}
