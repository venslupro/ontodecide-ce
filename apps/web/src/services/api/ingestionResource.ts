/**
 * Ingestion resource (Ingestion service).
 *
 * Covers sync ingest, async file ingest, webhook callbacks, and job status
 * lookups. {@code sync} is suitable for small interactive batches (<=10
 * entities); {@code file} pushes larger payloads through a queue worker.
 */
import { httpGet, httpPost } from './client';
import type {
  ApiResponse,
  IngestFileDto,
  IngestJobEnqueued,
  IngestPayload,
  IngestSyncResult,
} from '@ontodecide/shared';

/**
 * {@code POST /api/ingest/sync}. Accepts an {@link IngestPayload} (aliased
 * by {@code IngestSyncDto}) and returns immediate accept/reject counts.
 */
export async function sync(
  body: IngestPayload,
): Promise<ApiResponse<IngestSyncResult>> {
  return httpPost<IngestSyncResult>('/api/ingest/sync', body);
}

/** {@code POST /api/ingest/file} — enqueue a file-based ingest job. */
export async function file(
  body: IngestFileDto,
): Promise<ApiResponse<IngestJobEnqueued>> {
  return httpPost<IngestJobEnqueued>('/api/ingest/file', body);
}

/**
 * {@code POST /api/ingest/webhook} — third-party callback entrypoint.
 * Body is deliberately untyped; the ETL transformer parses the payload
 * based on the webhook registration.
 */
export async function webhook(
  body: unknown,
): Promise<ApiResponse<{ success: boolean }>> {
  return httpPost<{ success: boolean }>('/api/ingest/webhook', body);
}

/** {@code GET /api/ingest/jobs/{id}}. */
export async function getJob(
  id: string,
): Promise<ApiResponse<IngestJobEnqueued & { progress?: number }>> {
  return httpGet<IngestJobEnqueued & { progress?: number }>(
    `/api/ingest/jobs/${encodeURIComponent(id)}`,
  );
}
