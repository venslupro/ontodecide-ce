/**
 * Ingestion HTTP handlers.
 *
 *   POST   /ingest/sync         — small JSON body (≤10 entities), writes
 *                                 straight to the Graph Service via the loader.
 *   POST   /ingest/file         — multipart upload; staged to R2, then
 *                                 enqueued for async ETL.
 *   POST   /ingest/webhook      — webhook callback; same as sync but with
 *                                 a configurable source label.
 *   GET    /ingest/jobs/:id     — poll the status of an async job.
 */
import type {Context} from 'hono';
import {
  CONFIG,
  ERROR_CODES,
  HEADERS,
  type IngestJobEnqueued,
  type IngestPayload,
  type IngestSyncResult,
  createIngestionB2Client,
  fail,
  jobId as newJobId,
  ok,
} from '@ontodecide/shared';
import type {IngestionEnv, IngestJobRecord} from '../types/env.js';
import {load} from '../etl/loader.js';
import {markQueued, readJob} from '../queue/consumer.js';

/** POST /ingest/sync — body: IngestPayload (validated by ingestSyncSchema). */
export async function syncIngestHandler(c: Context) {
  const env = c.env as IngestionEnv;
  const body = (await c.req.json()) as IngestPayload;
  return runSyncIngest(c, env, body);
}

/** POST /ingest/webhook — body: IngestPayload, source defaults to "webhook". */
export async function webhookHandler(c: Context) {
  const env = c.env as IngestionEnv;
  const body = (await c.req.json()) as IngestPayload;
  if (!body.source) {
    body.source = 'webhook';
  }
  return runSyncIngest(c, env, body);
}

/** POST /ingest/file — multipart upload, async path. */
export async function fileIngestHandler(c: Context) {
  const env = c.env as IngestionEnv;
  const tenantId = c.req.header(HEADERS.TENANT_ID);
  if (!tenantId) {
    return c.json(fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.'), 403);
  }
  const form = await c.req.parseBody();
  const file = form['file'];
  const format = String(form['format'] ?? 'json') as 'csv' | 'json' | 'parquet';
  const ontologyType = String(form['ontologyType'] ?? '');
  if (!ontologyType) {
    return c.json(
        fail(ERROR_CODES.VALIDATION_FAILED, 'ontologyType is required.'),
        400,
    );
  }
  if (!file) {
    return c.json(
        fail(ERROR_CODES.VALIDATION_FAILED, 'file is required.'),
        400,
    );
  }
  // Workers types declare parseBody values as `string | File`, but
  // multipart uploads actually produce a File at runtime.
  const uploadedFile = file as unknown as File;
  const id = newJobId();
  const objectKey = `${tenantId}/staging/${id}/${uploadedFile.name}`;
  const b2 = createIngestionB2Client(env);
  await b2.put(objectKey, await uploadedFile.arrayBuffer(), {
    customMetadata: {
      tenantId,
      ontologyType,
      format,
      originalName: uploadedFile.name,
    },
  });
  await env.INGEST_QUEUE.send({
    jobId: id,
    tenantId,
    objectKey,
    format,
    ontologyType,
    fieldMapping: parseMapping(form['mapping']),
    traceId: c.req.header(HEADERS.TRACE_ID) ?? 'no-trace',
    internalCallSecret: '',
  });
  const record: IngestJobRecord = {
    jobId: id,
    tenantId,
    status: 'queued',
    format,
    ontologyType,
    objectKey,
  };
  await markQueued(env, record);
  const result: IngestJobEnqueued = {jobId: id, status: 'queued'};
  return c.json(ok(result), 202);
}

/** GET /ingest/jobs/:id */
export async function jobStatusHandler(c: Context) {
  const env = c.env as IngestionEnv;
  const jobId = c.req.param('id');
  if (!jobId) {
    return c.json(
        fail(ERROR_CODES.VALIDATION_FAILED, 'Job id is required.'),
        400,
    );
  }
  const tenantId = c.req.header(HEADERS.TENANT_ID);
  const record = await readJob(env, jobId);
  if (!record) {
    return c.json(
        fail(ERROR_CODES.NOT_FOUND, `Job ${jobId} not found.`),
        404,
    );
  }
  if (record.tenantId !== tenantId) {
    return c.json(
        fail(ERROR_CODES.AUTH_FORBIDDEN, 'Job belongs to a different tenant.'),
        403,
    );
  }
  return c.json(ok(record), 200);
}

/**
 * Shared sync ingestion logic used by both `/ingest/sync` and
 * `/ingest/webhook`.
 */
async function runSyncIngest(
    c: Context,
    env: IngestionEnv,
    body: IngestPayload,
) {
  const tenantId = c.req.header(HEADERS.TENANT_ID);
  if (!tenantId) {
    return c.json(fail(ERROR_CODES.AUTH_FORBIDDEN, 'Missing tenant id.'), 403);
  }
  if (body.entities.length > CONFIG.INGEST_SYNC_THRESHOLD) {
    return c.json(
        fail(
            ERROR_CODES.INGEST_PAYLOAD_TOO_LARGE,
            `Sync path accepts up to ${CONFIG.INGEST_SYNC_THRESHOLD}` +
            ` entities; use /ingest/file instead.`,
        ),
        413,
    );
  }
  if (body.tenant_id !== tenantId) {
    return c.json(fail(ERROR_CODES.AUTH_FORBIDDEN, 'tenant_id mismatch.'), 403);
  }
  // Enforce the header tenant id on every entity (security: the body
  // tenant_id is only used for the equality check above).
  const payload: IngestPayload = {
    tenant_id: tenantId,
    entities: body.entities.map((e) => ({...e, tenant_id: tenantId})),
    relations: body.relations,
    source: body.source,
  };
  const traceId = c.req.header(HEADERS.TRACE_ID) ?? 'no-trace';
  const result = await load(env.GRAPH_SERVICE, payload, traceId);
  const syncResult: IngestSyncResult = {
    accepted: result.accepted,
    rejected: result.rejected,
    errors: result.errors.length > 0 ? result.errors : undefined,
  };
  return c.json(ok(syncResult, traceId), 200);
}

function parseMapping(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}
