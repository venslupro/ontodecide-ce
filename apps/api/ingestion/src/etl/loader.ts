/**
 * Loader: push transformed entity batches into the Graph Service.
 *
 * The Graph Service exposes `POST /entities` (after the Gateway strips the
 * `/api` prefix). The Loader calls that endpoint directly via the Worker
 * service URL, propagating the identity headers and the internal-call
 * marker so the Graph Worker accepts the request.
 *
 * Batches are chunked at 50 entities per request to keep each Cypher
 * transaction under the 10ms CPU budget. A single `POST /entities` call
 * accepts entities + relations in one body, so each chunk is self-contained.
 */
import {
  CONFIG,
  HEADERS,
  type IngestPayload,
  uuid,
} from '@ontodecide/shared';

const CHUNK_SIZE = 50;

/** Result reported back to the Ingestion orchestrator. */
export interface LoadResult {
  accepted: number;
  rejected: number;
  errors: string[];
}

/**
 * Push entities + relations into the Graph Service.
 *
 * @param url Base URL of the Graph Service (no trailing slash).
 * @param payload Tenant-scoped entity batch.
 * @param traceId Trace id propagated from the original request.
 */
export async function load(
    url: string,
    payload: IngestPayload,
    traceId: string,
): Promise<LoadResult> {
  const {entities, relations} = payload;
  let accepted = 0;
  let rejected = 0;
  const errors: string[] = [];
  for (let i = 0; i < entities.length; i += CHUNK_SIZE) {
    const chunk = entities.slice(i, i + CHUNK_SIZE);
    const chunkRelations = relations.filter((r) =>
      chunk.some((e) => e.id === r.source || e.id === r.target),
    );
    const body: IngestPayload = {
      tenant_id: payload.tenant_id,
      entities: chunk,
      relations: chunkRelations,
      source: payload.source,
    };
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/entities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [HEADERS.TENANT_ID]: payload.tenant_id,
          [HEADERS.TRACE_ID]: traceId,
          [HEADERS.INTERNAL]: '1',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        rejected += chunk.length;
        errors.push(`Chunk ${i / CHUNK_SIZE}: HTTP ${response.status}`);
        continue;
      }
      const json = (await response.json()) as {data?: {accepted?: number}};
      accepted += json.data?.accepted ?? chunk.length;
    } catch (err) {
      rejected += chunk.length;
      errors.push(`Chunk ${i / CHUNK_SIZE}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Mark CONFIG import as used (kept for the future chunk-size config).
  void CONFIG;
  void uuid;
  return {accepted, rejected, errors};
}
