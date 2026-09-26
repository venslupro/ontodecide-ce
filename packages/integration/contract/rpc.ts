/**
 * @fileoverview RPC contract exposed by data-integration (IntegrationRpc).
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {
  DataHealthDto,
  JobDto,
  RawRecordDto,
  SourceDef,
  SourceDto,
  TxnType,
  WriteResult,
} from './types';

/** Data integration RPC surface. */
export interface IntegrationRpc {
  listSources(ctx: CallCtx): Promise<SourceDto[]>;
  getSource(ctx: CallCtx, id: string): Promise<SourceDto>;
  createSource(ctx: CallCtx, def: SourceDef): Promise<SourceDto>;
  updateSource(
    ctx: CallCtx,
    id: string,
    patch: Partial<SourceDef>,
  ): Promise<SourceDto>;
  deleteSource(ctx: CallCtx, id: string): Promise<void>;
  /** B2 presigned PUT for archiving the raw file. */
  presignUpload(
    ctx: CallCtx,
    sourceId: string,
    fileName: string,
    bytes: number,
  ): Promise<{url: string; key: string; expiresAt: string; jobId: string}>;
  /**
   * Accepts ≤ 500 records, splits them into ≤ 50-record messages on the
   * `ingest` queue. Creates the job when `jobId` is omitted.
   */
  submitBatch(
    ctx: CallCtx,
    sourceId: string,
    batch: {
      jobId?: string;
      seq: number;
      last: boolean;
      records: Record<string, unknown>[];
      txnType?: TxnType;
    },
  ): Promise<{jobId: string; queuedMessages: number}>;
  /** Verifies HMAC + replay window, then enqueues. No ctx: tenant comes from the source. */
  acceptWebhook(
    sourceId: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{accepted: number; jobId: string}>;
  listJobs(
    ctx: CallCtx,
    filter?: {sourceId?: string; limit?: number},
  ): Promise<JobDto[]>;
  getJob(ctx: CallCtx, jobId: string): Promise<JobDto>;
  listRejected(ctx: CallCtx, jobId: string): Promise<RawRecordDto[]>;
  /** Re-enqueues rejected records, optionally with corrected payloads. */
  replayRejected(
    ctx: CallCtx,
    jobId: string,
    fixes?: {id: string; payload: Record<string, unknown>}[],
  ): Promise<{requeued: number}>;
  /** Called by object-graph after writing one message group. */
  reportWriteResult(
    ctx: CallCtx,
    jobId: string,
    seq: number,
    last: boolean,
    r: WriteResult,
  ): Promise<void>;
  /** Per-source freshness and quality. */
  dataHealth(ctx: CallCtx): Promise<DataHealthDto[]>;
  /** Pauses sources whose mapping targets the given object types. */
  pauseSourcesForTypes(
    ctx: CallCtx,
    objectTypes: string[],
  ): Promise<{paused: number}>;
}
