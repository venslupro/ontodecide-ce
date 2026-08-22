/**
 * Loader: push transformed entity batches into the Graph Service.
 *
 * Calls the Graph Worker via a **Service Binding** (`Fetcher`) — zero-cost,
 * in-account routing with no external-request billing. The Graph endpoint
 * is `POST /entities` (after the Gateway strips the `/api` prefix).
 * Identity/tenant headers and the internal-call marker are set so the
 * Graph Worker accepts the request directly from Ingestion (no round-trip
 * through the Gateway).
 *
 * Batches are chunked at 50 entities per request to keep each Cypher
 * transaction under the 10ms CPU budget. A single `POST /entities` call
 * accepts entities + relations in one body, so each chunk is self-contained.
 */
import { CONFIG, HEADERS, type IngestPayload, uuid } from '@ontodecide/shared';

const CHUNK_SIZE = 50;
/** Dummy origin used for Service Binding calls (host is ignored). */
const INTERNAL_ORIGIN = 'https://internal';

/** Result reported back to the Ingestion orchestrator. */
export interface LoadResult {
  accepted: number;
  rejected: number;
  errors: string[];
}

/**
 * Push entities + relations into the Graph Service via a Service Binding.
 *
 * @param graphBinding  `GRAPH_SERVICE` Service Binding Fetcher.
 * @param payload       Tenant-scoped entity batch.
 * @param traceId       Trace id propagated from the original request.
 */
export async function load(
  graphBinding: Fetcher,
  payload: IngestPayload,
  traceId: string,
): Promise<LoadResult> {
  const { entities, relations } = payload;
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
      const response = await graphBinding.fetch(`${INTERNAL_ORIGIN}/entities`, {
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
      const json = (await response.json()) as { data?: { accepted?: number } };
      accepted += json.data?.accepted ?? chunk.length;
    } catch (err) {
      rejected += chunk.length;
      errors.push(`Chunk ${i / CHUNK_SIZE}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Mark CONFIG import as used (kept for the future chunk-size config).
  void CONFIG;
  void uuid;
  return { accepted, rejected, errors };
}
