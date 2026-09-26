/**
 * @fileoverview Data integration DTOs: sources, mappings, quality rules,
 * jobs and rejected records.
 */

import type {CallCtx, Provenance} from '@ontodecide/shared-kernel';

/** Connector kinds. */
export type SourceKind = 'file' | 'rest' | 'webhook';

/** Conflict resolution policy applied by object-graph. */
export type ConflictPolicy =
  'latest-wins' | 'source-priority' | 'max-confidence';

/**
 * Field mapping from source records to an object type. `transform` is a
 * chain such as `trim|toNumber|clamp(0,100)` (≤ 5 steps).
 */
export interface MappingSpec {
  targetType: string;
  primaryKey: {from: string; transform?: string};
  fields: {to: string; from: string; transform?: string}[];
  /** Links created from the record; `toKey` names the field holding the target key. */
  links?: {
    type: string;
    toType: string;
    toKey: string;
    split?: string;
    weightFrom?: string;
  }[];
  /** Field holding the source timestamp (latest-wins). */
  sourceTsFrom?: string;
}

/** Record-level quality rule. */
export interface QualityRule {
  prop: string;
  kind: 'required' | 'range' | 'format' | 'ref' | 'freshness';
  /** range: [min,max]; format: regex; freshness: max age in hours; ref: object type. */
  arg?: unknown;
  onFail: 'reject' | 'clamp' | 'defer';
}

/** File connector config (parsing happens in the browser). */
export interface FileSourceConfig {
  format?: 'csv' | 'xlsx' | 'json';
}

/** REST pull connector config. */
export interface RestSourceConfig {
  url: string;
  method?: 'GET' | 'POST';
  /** Plain headers. Secret headers go to `secretHeaders` (stored encrypted). */
  headers?: Record<string, string>;
  secretHeaders?: Record<string, string>;
  /** JSONPath-like selector for the records array, e.g. `$.data.items`. */
  itemsPath: string;
  /** Query parameter carrying the incremental cursor. */
  cursorParam?: string;
  /** JSONPath of the next cursor in the response. */
  cursorPath?: string;
  /** ≤ 500 records per pull. */
  pageLimit?: number;
}

/** Webhook connector config. */
export interface WebhookSourceConfig {
  /** Optional JSONPath for the records array; defaults to body or [body]. */
  itemsPath?: string;
}

/** Source definition as submitted by callers. */
export interface SourceDef {
  name: string;
  kind: SourceKind;
  config: FileSourceConfig | RestSourceConfig | WebhookSourceConfig;
  mapping: MappingSpec;
  qualityRules?: QualityRule[];
  conflictPolicy?: ConflictPolicy;
  /** Higher wins under source-priority. */
  priority?: number;
  /** Cron-like label; REST pulls run every 15 minutes when enabled. */
  schedule?: string;
  enabled?: boolean;
}

/** Stored source (secrets redacted). */
export interface SourceDto extends Omit<SourceDef, 'config'> {
  id: string;
  tenantId: string;
  config: FileSourceConfig | RestSourceConfig | WebhookSourceConfig;
  enabled: boolean;
  cursor: string | null;
  createdAt: string;
  lastJobAt?: string;
  /** Returned only once, on creation of webhook sources. */
  webhookSecret?: string;
  /** Paused because an ontology breaking change invalidated the mapping. */
  paused?: boolean;
}

/** Dataset transaction type. */
export type TxnType = 'APPEND' | 'SNAPSHOT';

/** Ingestion job status. */
export type JobStatus =
  'Queued' | 'Running' | 'Succeeded' | 'PartiallyFailed' | 'Failed';

/** Ingestion job (one Dataset transaction). */
export interface JobDto {
  id: string;
  tenantId: string;
  sourceId: string;
  txnType: TxnType;
  status: JobStatus;
  received: number;
  upserted: number;
  merged: number;
  skipped: number;
  rejected: number;
  /** 0..1 = accepted / received. */
  qualityScore: number;
  b2Key?: string;
  startedAt: string;
  finishedAt?: string;
  /** Message groups sent / acknowledged by object-graph. */
  totalGroups?: number;
  doneGroups?: number;
}

/** A rejected source record kept for correction and replay (30 days). */
export interface RawRecordDto {
  id: string;
  jobId: string;
  rowNo: number;
  payload: Record<string, unknown>;
  errorCode: string;
  errorDetail?: string;
  createdAt: string;
}

/** Per-source data health for the cockpit. */
export interface DataHealthDto {
  sourceId: string;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  lastJobAt?: string;
  lastStatus?: JobStatus;
  qualityScore: number | null;
  /** True when no data arrived within the freshness window (24h default). */
  stale: boolean;
}

/** Write result reported back by object-graph per message group. */
export interface WriteResult {
  upserted: number;
  merged: number;
  skipped: number;
  rejected: {row: number; code: string; detail?: string}[];
}

/** Message on the `ingest` queue (≤ 50 records, ≤ 120 KB). */
export interface IngestMsg {
  ctx: CallCtx;
  sourceId: string;
  jobId: string;
  /** Monotonic within the job; client batches use seq*1000+n. */
  seq: number;
  last: boolean;
  /** Row number of records[0] within the job. */
  rowOffset: number;
  records: Record<string, unknown>[];
}

/** Ingestion boundaries (detailed design, boundary values). */
export const INGEST_LIMITS = {
  batchRecordsMax: 500,
  messageRecordsMax: 50,
  messageBytesMax: 120 * 1024,
  transformChainMax: 5,
  restPageLimitMax: 500,
  webhookWindowSec: 300,
  fileBytesMax: 20 * 1024 * 1024,
  fileRowsMax: 10_000,
} as const;

/** One upsert command (≤ 50 per message). */
export interface UpsertCmd {
  type: string;
  primaryKey: string;
  props: Record<string, unknown>;
  links: {type: string; toType: string; toKey: string; weight?: number}[];
  provenance: Provenance;
  /** Row number within the job (for rejection reporting). */
  row: number;
  /** Source-local external key for alias resolution. */
  externalKey?: string;
}

/** Message on the `object-writes` queue. */
export interface ObjectWriteMsg {
  ctx: CallCtx;
  jobId: string;
  seq: number;
  last: boolean;
  schemaVersion: string;
  policy: 'latest-wins' | 'source-priority' | 'max-confidence';
  cmds: UpsertCmd[];
}
