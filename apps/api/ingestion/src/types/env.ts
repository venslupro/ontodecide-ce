/**
 * Environment bindings for the Ingestion Service.
 */
import type {BaseEnv} from '@ontodecide/shared';

export interface IngestionEnv extends BaseEnv {
  /** Backblaze B2 S3-compatible credentials + bucket for staging files. */
  B2_KEY_ID: string;
  B2_KEY: string;
  B2_REGION: string;
  B2_INGESTION_BUCKET: string;
  /** Queue producer for async ETL jobs. */
  INGEST_QUEUE: Queue<IngestJobMessage>;
  /** KV namespace holding job-status records (polled by the client). */
  JOBS: KVNamespace;
  /** Downstream Graph Service URL. */
  GRAPH_SERVICE_URL: string;
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
  /** Internal call marker — propagates the Gateway's identity to Graph. */
  internalCallSecret: string;
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
