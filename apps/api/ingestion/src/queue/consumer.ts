/**
 * Queue consumer for the Ingestion Service.
 *
 * Each batch of {@link IngestJobMessage}s is processed independently:
 *   1. Read the staged file from R2.
 *   2. Extract records via the extractor.
 *   3. Transform them onto the tenant's ontology.
 *   4. Load them into the Graph Service in chunks.
 *   5. Update the job-status record in KV so the client can poll.
 *
 * Failures are retried up to `max_retries` (set in wrangler.toml); after
 * that the message is routed to the dead-letter queue.
 */
import {
  ERROR_CODES,
  nowIso,
  type IngestPayload,
  createIngestionB2Client,
} from '@ontodecide/shared';
import { extract } from '../etl/extractor.js';
import { transform } from '../etl/transformer.js';
import { load } from '../etl/loader.js';
import type { IngestionEnv, IngestJobMessage, IngestJobRecord } from '../types/env.js';

const JOB_KEY_PREFIX = 'ingest:job:';
const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Cloudflare Workers `queue` handler — invoked by the platform when a
 * message batch is delivered to the consumer.
 */
export async function handleQueueBatch(
  batch: MessageBatch<IngestJobMessage>,
  env: IngestionEnv,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      const body = message.body;
      try {
        await processJob(body, env);
        message.ack();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await updateJob(env, body.jobId, { status: 'failed', error: reason, finishedAt: nowIso() });
        // Retry: the platform will redeliver up to max_retries, after which
        // the message is moved to the dead-letter queue automatically.
        message.retry();
      }
    }),
  );
}

async function processJob(message: IngestJobMessage, env: IngestionEnv): Promise<void> {
  await updateJob(env, message.jobId, { status: 'running', startedAt: nowIso() });
  const b2 = createIngestionB2Client(env);
  const object = await b2.get(message.objectKey);
  if (!object) {
    throw new Error(`B2 object not found: ${message.objectKey}`);
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const records = await extract(bytes, message.format);
  const transformed = transform(
    records,
    message.tenantId,
    message.ontologyType,
    message.objectKey,
    message.fieldMapping,
  );
  const payload: IngestPayload = {
    tenant_id: message.tenantId,
    entities: transformed.entities,
    relations: transformed.relations,
    source: message.objectKey,
  };
  const result = await load(env.GRAPH_SERVICE, payload, message.traceId);
  if (result.rejected > 0 && result.accepted === 0) {
    throw new Error(`All ${result.rejected} entities rejected: ${result.errors.join('; ')}`);
  }
  await updateJob(env, message.jobId, {
    status: 'succeeded',
    accepted: result.accepted,
    rejected: result.rejected + transformed.rejected,
    finishedAt: nowIso(),
  });
  // Delete the staged file once the job is durable; the archive copy in
  // `archive/<tenantId>/` is preserved by the Cleanup service's regret
  // window.
  await b2.delete(message.objectKey);
}

/** Update the job-status record in KV (used by GET /jobs/:id). */
async function updateJob(
  env: IngestionEnv,
  jobId: string,
  patch: Partial<IngestJobRecord>,
): Promise<void> {
  const key = JOB_KEY_PREFIX + jobId;
  const existing = await env.JOBS.get<IngestJobRecord>(key, 'json');
  const updated: IngestJobRecord = {
    jobId,
    tenantId: patch.tenantId ?? existing?.tenantId ?? 'unknown',
    status: patch.status ?? existing?.status ?? 'queued',
    format: patch.format ?? existing?.format ?? '',
    ontologyType: patch.ontologyType ?? existing?.ontologyType ?? '',
    objectKey: patch.objectKey ?? existing?.objectKey ?? '',
    accepted: patch.accepted ?? existing?.accepted,
    rejected: patch.rejected ?? existing?.rejected,
    error: patch.error ?? existing?.error,
    startedAt: patch.startedAt ?? existing?.startedAt,
    finishedAt: patch.finishedAt ?? existing?.finishedAt,
  };
  await env.JOBS.put(key, JSON.stringify(updated), {
    expirationTtl: JOB_TTL_SECONDS,
  });
}

/** Read the full job record (used by the GET /jobs/:id HTTP handler). */
export async function readJob(env: IngestionEnv, jobId: string): Promise<IngestJobRecord | null> {
  return env.JOBS.get<IngestJobRecord>(JOB_KEY_PREFIX + jobId, 'json');
}

/** Mark a freshly-enqueued job as queued in KV. */
export async function markQueued(env: IngestionEnv, record: IngestJobRecord): Promise<void> {
  await env.JOBS.put(JOB_KEY_PREFIX + record.jobId, JSON.stringify(record), {
    expirationTtl: JOB_TTL_SECONDS,
  });
}

/** Suppress unused-import warning for ERROR_CODES (kept for future retry logic). */
void ERROR_CODES;
