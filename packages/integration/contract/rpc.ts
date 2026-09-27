/**
 * @fileoverview RPC contract of data-integration (IntegrationRpc entry
 * point). Depends on ontology-manager and object-graph; has its own AiPort
 * (Workers AI) and does not depend on decision-engine.
 */

import type {
  CallCtx,
  PageRequest,
  PageResult,
  QuotaItem,
} from '@ontodecide/shared-kernel';
import type {
  BatchInput,
  BatchResult,
  CreateImportInput,
  JobDto,
  MappingDraft,
  MappingDraftInput,
  MappingSpec,
} from './types';

/** data-integration RPC surface. */
export interface IntegrationRpc {
  /**
   * Creates a job after checking object/link headroom (ObjectGraphRpc.stats)
   * and reserving `totalRows` of the user's daily import rows; otherwise
   * QUOTA_EXCEEDED.
   */
  createImport(ctx: CallCtx, input: CreateImportInput): Promise<JobDto>;
  /** Sets the mapping while no batch has been received (else CONFLICT). */
  putMapping(
    ctx: CallCtx,
    jobId: string,
    mapping: MappingSpec,
  ): Promise<JobDto>;
  /**
   * Maps, validates and writes one batch synchronously (upsertBatch). The
   * same seq returns the first result. `last` marks the job DONE.
   */
  submitBatch(
    ctx: CallCtx,
    jobId: string,
    batch: BatchInput,
  ): Promise<BatchResult>;
  getImport(ctx: CallCtx, jobId: string): Promise<JobDto>;
  listImports(ctx: CallCtx, page: PageRequest): Promise<PageResult<JobDto>>;
  /** ≤ 2 AI drafts per user per day; afterwards rankedBy = rules. */
  mappingDraft(
    ctx: CallCtx,
    jobId: string,
    input: MappingDraftInput,
  ): Promise<MappingDraft>;
  /**
   * Loads the sample scenario once per workspace, within the global daily
   * seed budget (QUOTA_EXCEEDED) — CONFLICT when already loaded.
   */
  loadSample(ctx: CallCtx): Promise<JobDto>;
  /** importRowsToday and mappingDraftsToday of the caller. */
  usage(ctx: CallCtx): Promise<QuotaItem[]>;
}
