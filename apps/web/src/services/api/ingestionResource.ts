/**
 * Ingestion resource (Ingestion service).
 *
 * Covers sync ingest, async file ingest, webhook callbacks, and job status
 * lookups. {@code sync} is suitable for small interactive batches (<=10
 * entities); {@code file} pushes larger payloads through a queue worker.
 */
import { executeMultipart, httpDelete, httpGet, httpPost, httpPut } from './client';
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

/**
 * {@code POST /api/ingest/file} — enqueue a file-based ingest job.
 *
 * The file is sent as multipart/form-data with the following fields:
 *   - file: the uploaded File (binary)
 *   - format: 'csv' | 'json' | 'parquet'
 *   - ontologyType: ontology type the records map onto
 *   - mapping: optional JSON-encoded field mapping
 *
 * @param file The file to upload.
 * @param meta Format, ontology type, and optional field mapping.
 */
export async function file(
  file: File,
  meta: Omit<IngestFileDto, 'objectKey'>,
): Promise<ApiResponse<IngestJobEnqueued>> {
  const form = new FormData();
  form.append('file', file);
  form.append('format', meta.format);
  form.append('ontologyType', meta.ontologyType);
  if (meta.fieldMapping) {
    form.append('mapping', JSON.stringify(meta.fieldMapping));
  }
  return executeMultipart<IngestJobEnqueued>('/api/ingest/file', form);
}

/**
 * {@code POST /api/ingest/webhook} — third-party callback entrypoint.
 * Reuses the sync ingestion path; returns accept/reject counts.
 */
export async function webhook(
  body: IngestPayload,
): Promise<ApiResponse<IngestSyncResult>> {
  return httpPost<IngestSyncResult>('/api/ingest/webhook', body);
}

/**
 * Full job-status record returned by {@code GET /api/ingest/jobs/{id}}.
 * The shared {@link IngestJobEnqueued} only models the initial enqueue
 * response; this interface captures the full lifecycle statuses.
 */
export interface IngestJobStatus {
  jobId: string;
  tenantId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  format: string;
  ontologyType: string;
  objectKey: string;
  accepted?: number;
  rejected?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** {@code GET /api/ingest/jobs/{id}}. */
export async function getJob(
  id: string,
): Promise<ApiResponse<IngestJobStatus>> {
  return httpGet<IngestJobStatus>(
    `/api/ingest/jobs/${encodeURIComponent(id)}`,
  );
}

// ---------------------------------------------------------------------------
// Data source management (Sync Connectors page).
// ---------------------------------------------------------------------------

/** A data source record returned by the ingestion service. */
export interface DataSource {
  sourceId: string;
  name: string;
  kind: 'csv' | 'json' | 'parquet' | 'webhook';
  url: string;
  auth: string;
  status: 'healthy' | 'syncing' | 'error' | 'paused';
  lastSync?: string;
  nextSync?: string;
  cron?: string;
  timezone?: string;
  scheduleEnabled?: boolean;
  createdAt: string;
}

/** Body for creating a new data source. */
export interface CreateSourceBody {
  name: string;
  kind: 'csv' | 'json' | 'parquet' | 'webhook';
  url: string;
  auth?: string;
  cron?: string;
  timezone?: string;
  scheduleEnabled?: boolean;
}

/** Body for updating a source schedule. */
export interface UpdateScheduleBody {
  cron: string;
  timezone: string;
  scheduleEnabled: boolean;
}

/** Test-connection result returned by {@code POST /api/ingest/sources/:id/test}. */
export interface TestSourceResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

/** {@code GET /api/ingest/sources} — list data sources for the tenant. */
export async function listSources(): Promise<ApiResponse<DataSource[]>> {
  return httpGet<DataSource[]>('/api/ingest/sources');
}

/** {@code POST /api/ingest/sources} — create a new data source. */
export async function createSource(
  body: CreateSourceBody,
): Promise<ApiResponse<DataSource>> {
  return httpPost<DataSource>('/api/ingest/sources', body);
}

/** {@code DELETE /api/ingest/sources/:id} — delete a data source. */
export async function deleteSource(
  id: string,
): Promise<ApiResponse<{ sourceId: string }>> {
  return httpDelete<{ sourceId: string }>(
    `/api/ingest/sources/${encodeURIComponent(id)}`,
  );
}

/** {@code POST /api/ingest/sources/:id/test} — test a source connection. */
export async function testSource(
  id: string,
): Promise<ApiResponse<TestSourceResult>> {
  return httpPost<TestSourceResult>(
    `/api/ingest/sources/${encodeURIComponent(id)}/test`,
  );
}

/** {@code PUT /api/ingest/sources/:id/schedule} — update sync schedule. */
export async function updateSchedule(
  id: string,
  body: UpdateScheduleBody,
): Promise<ApiResponse<DataSource>> {
  return httpPut<DataSource>(
    `/api/ingest/sources/${encodeURIComponent(id)}/schedule`,
    body,
  );
}
