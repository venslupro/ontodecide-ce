/**
 * DTOs for the Ingestion service.
 */
import type { IngestPayload } from '../types/graph.js';

/** Sync ingestion request: small payloads (<=10 entities). */
export type IngestSyncDto = IngestPayload;

/** Async ingestion request: file upload metadata. */
export interface IngestFileDto {
  /** Tenant-scoped object key under R2. */
  objectKey: string;
  /** Format hint used by the ETL transformer. */
  format: 'csv' | 'json' | 'parquet' | 'webhook';
  /** Ontology type the records should be mapped onto. */
  ontologyType: string;
  /** Optional field-mapping overrides. */
  fieldMapping?: Record<string, string>;
}

/** Result returned by the sync ingestion path. */
export interface IngestSyncResult {
  accepted: number;
  rejected: number;
  errors?: string[];
}

/** Result returned when an async job is enqueued. */
export interface IngestJobEnqueued {
  jobId: string;
  status: 'queued';
}
