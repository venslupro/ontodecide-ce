/**
 * @fileoverview Ports of the data-integration application layer and the
 * dependencies its use cases receive from the composition root.
 */

import type {CallCtx, Clock, Logger} from '@ontodecide/shared-kernel';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {BatchResult, MappingSpec, RejectDto} from '../contract';
import type {BatchDelta, JobRecord} from '../domain';

/** A stored batch (int_batch). */
export interface StoredBatch {
  seq: number;
  rows: number;
  result: BatchResult;
  /** Object keys accepted by the batch (primary-key conflict check). */
  keys: string[];
}

/** Everything written when a batch commits. */
export interface BatchCommit {
  jobId: string;
  seq: number;
  rows: number;
  /** Unique per attempt; decides which of two concurrent retries won. */
  attempt: string;
  result: BatchResult;
  keys: string[];
  delta: BatchDelta;
  last: boolean;
  rejects: RejectDto[];
  nowMs: number;
}

/** Workspace-scoped job storage (int_job, int_batch, int_reject, int_mapping). */
export interface JobRepository {
  insert(job: JobRecord): Promise<void>;
  get(id: string): Promise<JobRecord | null>;
  /** Newest first; `beforeId` excludes it and everything newer. */
  list(beforeId: string | null, limit: number): Promise<JobRecord[]>;
  /** Sets the mapping while nothing was received; false otherwise. */
  setMapping(id: string, mapping: MappingSpec, nowMs: number): Promise<boolean>;
  /** Saves the mapping for reuse (one per target type). */
  saveMapping(
    name: string | null,
    spec: MappingSpec,
    nowMs: number,
  ): Promise<void>;
  batches(jobId: string): Promise<StoredBatch[]>;
  /**
   * Stores the batch, updates the job counters and inserts rejects (≤ 200
   * per job) atomically. False when another attempt already stored `seq`.
   */
  commitBatch(c: BatchCommit): Promise<boolean>;
  /** Stored rejects (≤ 200), by row. */
  rejects(jobId: string): Promise<RejectDto[]>;
  markFailed(id: string, nowMs: number): Promise<void>;
}

/** Usage counter keys of int_usage. */
export type UsageKey =
  'import_rows' | 'seed_rows' | 'seed_loaded' | 'mapping_ai' | 'neurons';

/** A counter: `scope` is a tenant id or `*` for service-wide budgets. */
export interface UsageRef {
  day: string;
  scope: string;
  key: UsageKey;
}

/** Atomic capped counters (int_usage). */
export interface UsageRepository {
  /** Takes `n` units when the total stays ≤ cap. */
  take(ref: UsageRef, n: number, cap: number): Promise<boolean>;
  /** Adds `delta` (negative to refund); never below zero. */
  adjust(ref: UsageRef, delta: number): Promise<void>;
  read(ref: UsageRef): Promise<number>;
}

/** Column offered to the AI (no sensitive values). */
export interface AiField {
  name: string;
  samples: string[];
}

/** Property offered to the AI (never sensitive ones). */
export interface AiProp {
  apiName: string;
  dataType: string;
  label: string;
}

/** AI mapping request. */
export interface AiMappingRequest {
  targetType: string;
  fields: AiField[];
  props: AiProp[];
}

/** AI mapping answer; `neurons` is null when the model reports no usage. */
export interface AiMappingResult {
  pairs: {from: string; to: string}[];
  neurons: number | null;
}

/** data-integration's own Workers AI anti-corruption layer. */
export interface AiPort {
  suggestMappings(req: AiMappingRequest): Promise<AiMappingResult>;
}

/** Limits and budgets (Worker vars). */
export interface IntegrationConfig {
  importRowsDaily: number;
  seedRowsDaily: number;
  mappingAiDaily: number;
  neuronsDailyBudget: number;
  /** Estimated Neurons per mapping draft (≈ 19). */
  draftNeurons: number;
  /** Reservation factor (1.3). */
  reserveFactor: number;
  maxObjects: number;
  maxLinks: number;
}

/** Dependencies of the use cases. */
export interface IntegrationDeps {
  jobs(ctx: CallCtx): JobRepository;
  usage: UsageRepository;
  ontology: Pick<OntologyRpc, 'getCompiledSchema' | 'setTemplate'>;
  objects: Pick<ObjectGraphRpc, 'stats' | 'upsertBatch'>;
  /** Absent locally (no Workers AI binding): drafts use rules only. */
  ai: AiPort | null;
  clock: Clock;
  logger: Logger;
  config: IntegrationConfig;
  newId(nowMs: number): string;
}
