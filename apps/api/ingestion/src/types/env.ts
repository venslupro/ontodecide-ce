/**
 * Environment bindings for the Ingestion Service.
 *
 * Downstream Graph calls go through a Service Binding (zero-cost) when
 * available; `GRAPH_SERVICE_URL` is kept as a dev-only fallback (e.g.
 * running ingestion against a remote Graph from a local `wrangler dev`).
 *
 * This Worker trusts Gateway-injected identity headers — it does NOT hold
 * the JWT signing secret.
 */
import type {BaseEnv, IngestionGraphBinding} from '@ontodecide/shared';

export interface IngestionEnv extends BaseEnv, IngestionGraphBinding {
  /** Backblaze B2 S3-compatible credentials + bucket for staging files. */
  B2_KEY_ID: string;
  B2_KEY: string;
  B2_REGION: string;
  B2_INGESTION_BUCKET: string;
  /** Queue producer for async ETL jobs. */
  INGEST_QUEUE: Queue<IngestJobMessage>;
  /** KV namespace holding job-status records (polled by the client). */
  JOBS: KVNamespace;
  /**
   * Fallback URL for calling the Graph Service (dev only — production uses
   * the `GRAPH_SERVICE` Service Binding).
   */
  GRAPH_SERVICE_URL?: string;
}

/** Message published to the ingestion queue. */
export interface IngestJobMessage {
  jobId: string;
  tenantId: string;
  /** R2 object key of the uploaded file. */
  objectKey: string;
  /** Format hint used by the extractor. */
  format: 'csv' | 'json' | 'parquet' | 'webhook';
  /** Ontology type the records map onto. */
  ontologyType: string;
  /** Optional field-mapping overrides. */
  fieldMapping?: Record<string, string>;
  /** Trace id propagated from the original request. */
  traceId: string;
  /** Unused (kept for backward message compat). */
  internalCallSecret?: string;
}

/** Job-status record stored in KV under `ingest:job:<jobId>`. */
export interface IngestJobRecord {
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

/** Small inline payload returned by the sync path. */
export interface IngestSyncPayload {
  tenant_id: string;
  entities: Array<{
    id: string;
    type: string;
    attributes: Record<string, unknown>;
    source: string;
    confidence?: number;
  }>;
  relations?: Array<{
    type: string;
    source: string;
    target: string;
    properties?: Record<string, unknown>;
  }>;
  source: string;
}
