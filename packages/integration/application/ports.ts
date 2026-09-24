/**
 * @fileoverview Ports (interfaces) the integration use cases depend on.
 * Implemented by infrastructure adapters and in-memory fakes.
 */

import type {CallCtx, Clock, Logger} from '@ontodecide/shared-kernel';
import type {CompiledModel} from '@ontodecide/ontology/contract';
import type {
  ConflictPolicy,
  IngestMsg,
  JobStatus,
  MappingSpec,
  ObjectWriteMsg,
  QualityRule,
  SourceKind,
  TxnType,
} from '../contract';

/** Secrets stored encrypted in `int_source.secret_enc`. */
export interface SourceSecrets {
  webhookSecret?: string;
  secretHeaders?: Record<string, string>;
}

/** A stored source (config without secrets). */
export interface SourceRecord {
  id: string;
  tenantId: string;
  name: string;
  kind: SourceKind;
  config: Record<string, unknown>;
  secretEnc: string | null;
  mapping: MappingSpec;
  qualityRules: QualityRule[];
  conflictPolicy: ConflictPolicy;
  priority: number;
  schedule: string | null;
  cursor: string | null;
  enabled: boolean;
  paused: boolean;
  lastJobAt: number | null;
  createdAt: number;
}

/** Source persistence. Every method is tenant scoped unless named otherwise. */
export interface SourceRepository {
  list(ctx: CallCtx): Promise<SourceRecord[]>;
  get(ctx: CallCtx, id: string): Promise<SourceRecord | null>;
  insert(s: SourceRecord): Promise<void>;
  update(s: SourceRecord): Promise<void>;
  delete(ctx: CallCtx, id: string): Promise<boolean>;
  setCursor(ctx: CallCtx, id: string, cursor: string | null): Promise<void>;
  touchLastJob(ctx: CallCtx, id: string, at: number): Promise<void>;
  setPaused(ctx: CallCtx, ids: string[], paused: boolean): Promise<number>;
  /** Webhook entry: looks a source up by id alone (tenant comes from it). */
  findForWebhook(id: string): Promise<SourceRecord | null>;
  /** Cron: enabled, unpaused REST sources across tenants. */
  listPullable(): Promise<SourceRecord[]>;
}

/** A stored job with its progress counters. */
export interface JobRecord {
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
  warnings: number;
  totalGroups: number;
  doneGroups: number;
  lastSeq: number | null;
  batches: number;
  ingestTotal: number;
  ingestDone: number;
  qualityScore: number | null;
  b2Key: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/** A rejected record to store. */
export interface RejectedRow {
  row: number;
  payload: Record<string, unknown>;
  code: string;
  detail?: string;
}

/** A stored rejected record. */
export interface RawRecordRow {
  id: string;
  jobId: string;
  rowNo: number;
  payload: Record<string, unknown>;
  errorCode: string;
  errorDetail: string | null;
  replayedAt: number | null;
  createdAt: number;
}

/** Outcome of processing one ingest message. */
export interface IngestProgress {
  seq: number;
  groups: number;
  rejected: RejectedRow[];
  warnings: number;
}

/** Job persistence, including idempotent progress updates. */
export interface JobRepository {
  create(job: JobRecord): Promise<void>;
  get(ctx: CallCtx, id: string): Promise<JobRecord | null>;
  list(
    ctx: CallCtx,
    filter: {sourceId?: string; limit: number},
  ): Promise<JobRecord[]>;
  /** Latest job per source of the tenant. */
  latestPerSource(ctx: CallCtx): Promise<JobRecord[]>;
  /** Existing batch record (messages enqueued), or null. */
  findBatch(
    ctx: CallCtx,
    jobId: string,
    seq: number,
  ): Promise<{messages: number} | null>;
  /**
   * Records a batch and bumps received / ingest_total / batches (and
   * last_seq). Returns false when the batch was already recorded.
   */
  recordBatch(
    ctx: CallCtx,
    jobId: string,
    b: {seq: number; last: boolean; records: number; messages: number},
    now: number,
  ): Promise<boolean>;
  /** Whether the ingest message was already processed. */
  isIngestProcessed(ctx: CallCtx, jobId: string, seq: number): Promise<boolean>;
  /**
   * Atomically marks an ingest message processed, stores its rejected rows
   * and bumps the counters. Returns false when already processed.
   */
  recordIngest(
    ctx: CallCtx,
    jobId: string,
    p: IngestProgress,
    now: number,
  ): Promise<boolean>;
  /**
   * Atomically records an object-writes group result. Returns false when
   * (jobId, seq) was already reported.
   */
  recordGroup(
    ctx: CallCtx,
    jobId: string,
    seq: number,
    r: {
      upserted: number;
      merged: number;
      skipped: number;
      rejected: RejectedRow[];
    },
    now: number,
  ): Promise<boolean>;
  /** Queued → Running (no-op otherwise). */
  markRunning(ctx: CallCtx, jobId: string): Promise<void>;
  /** Sets the terminal state if the job is not finished yet. */
  finish(
    ctx: CallCtx,
    jobId: string,
    status: JobStatus,
    qualityScore: number,
    finishedAt: number,
  ): Promise<boolean>;
}

/** Rejected record persistence. */
export interface RawRecordRepository {
  listForJob(
    ctx: CallCtx,
    jobId: string,
    opts?: {includeReplayed?: boolean},
  ): Promise<RawRecordRow[]>;
  markReplayed(ctx: CallCtx, ids: string[], at: number): Promise<void>;
}

/** Webhook replay protection. */
export interface NonceRepository {
  /** Returns false when the signature was seen before. */
  claim(signature: string, sourceId: string, ts: number): Promise<boolean>;
}

/** Retention and scheduled-task bookkeeping. */
export interface MaintenanceRepository {
  purgeRawRecords(before: number): Promise<number>;
  purgeNonces(before: number): Promise<number>;
  purgeProgress(before: number): Promise<number>;
  startRun(id: string, job: string, at: number): Promise<void>;
  finishRun(
    id: string,
    status: 'ok' | 'error',
    at: number,
    detail: Record<string, unknown>,
  ): Promise<void>;
}

/** Producer for the `ingest` queue. */
export interface IngestPublisher {
  publish(msgs: IngestMsg[]): Promise<void>;
}

/** Producer for the `object-writes` queue. */
export interface ObjectWritePublisher {
  publish(msg: ObjectWriteMsg): Promise<void>;
}

/** Presigned upload URL (empty url when archiving is disabled). */
export interface PresignedUpload {
  url: string;
  expiresAt: string;
}

/** Issues presigned PUT URLs for raw file archiving. */
export interface UploadPresigner {
  presignPut(
    key: string,
    bytes: number,
    expiresSec: number,
  ): Promise<PresignedUpload>;
}

/** Response of a REST pull. */
export interface RestResponse {
  status: number;
  body: unknown;
}

/** Performs REST pulls. */
export interface RestFetcher {
  get(
    url: string,
    init: {method: 'GET' | 'POST'; headers: Record<string, string>},
  ): Promise<RestResponse>;
}

/** Encrypts connector secrets. */
export interface SecretCipher {
  seal(secrets: SourceSecrets): Promise<string>;
  open(sealed: string): Promise<SourceSecrets>;
}

/** Provides the tenant's active compiled model. */
export interface ModelProvider {
  get(ctx: CallCtx): Promise<CompiledModel>;
}

/** Shared dependencies of the use cases. */
export interface AppDeps {
  sources: SourceRepository;
  jobs: JobRepository;
  rawRecords: RawRecordRepository;
  nonces: NonceRepository;
  maintenance: MaintenanceRepository;
  ingestQueue: IngestPublisher;
  objectWrites: ObjectWritePublisher;
  presigner: UploadPresigner;
  rest: RestFetcher;
  cipher: SecretCipher;
  models: ModelProvider;
  clock: Clock;
  logger: Logger;
  newId: () => string;
}
