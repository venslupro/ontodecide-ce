/**
 * @fileoverview Ports of the decision application layer. Infrastructure
 * provides the adapters (D1, Workers AI, Gemini, Groq, Vectorize) and the
 * composition root wires service bindings.
 */

import type {QueueSender, Rid} from '@ontodecide/shared-kernel';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {
  DecisionJobMsg,
  SituationRpc,
} from '@ontodecide/situation/contract';
import type {
  Perturbation,
  RecStatus,
  RecommendationDto,
  ScenarioDto,
  ScenarioResult,
} from '../contract';

/** Options of one completion. */
export interface LlmOptions {
  system?: string;
  /** Ask the provider for a JSON object. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

/** A completion. */
export interface LlmCompletion {
  text: string;
  /** Model id that produced the text. */
  model: string;
  /** Workers AI neurons consumed (estimated when not reported). */
  neurons: number;
}

/** A language model (or a chain of them). */
export interface LlmPort {
  /** Cache namespace, e.g. `chain:workers-ai,gemini` or `fake:test`. */
  readonly family: string;
  complete(prompt: string, opts?: LlmOptions): Promise<LlmCompletion>;
}

/** Text embeddings (bge-m3 in production). */
export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** An evaluated case kept for recall (RAG). */
export interface CaseRecord {
  id: string;
  tenantId: string;
  summary: string;
  outcome?: RecommendationDto['outcome'];
  /** Text used for similarity. */
  text: string;
  createdAt: number;
}

/** A recalled case. */
export interface SimilarCase {
  id: string;
  summary: string;
  outcome?: RecommendationDto['outcome'];
  score: number;
}

/** Stores and recalls similar cases. */
export interface CaseStore {
  add(c: CaseRecord): Promise<void>;
  similar(tenantId: string, text: string, k: number): Promise<SimilarCase[]>;
}

/** Object graph operations used by decision (service binding OBJECTS). */
export type GraphPort = Pick<
  ObjectGraphRpc,
  'impactSubgraph' | 'getObjects' | 'evaluateObjectSet' | 'applyAction'
>;

/** Ontology operations used by decision (service binding ONTOLOGY). */
export type ModelPort = Pick<OntologyRpc, 'getActiveModel'>;

/** Situation operations used by decision (service binding SITUATION). */
export type Notifier = Pick<SituationRpc, 'pushRecommendation' | 'recordUsage'>;

/** Producer of decision-jobs messages. */
export type JobQueue = Pick<QueueSender<DecisionJobMsg>, 'send'>;

/** Stored recommendation (DTO plus internal columns). */
export interface RecommendationRecord extends RecommendationDto {
  tenantId: string;
  requestedBy?: string;
  executedAt?: string;
}

/** Recommendation list filter. */
export interface RecommendationFilter {
  status?: RecStatus;
  focus?: Rid;
  limit: number;
}

/** Recommendation persistence. */
export interface RecommendationRepository {
  insert(rec: RecommendationRecord): Promise<void>;
  get(tenantId: string, id: string): Promise<RecommendationRecord | null>;
  list(
    tenantId: string,
    filter: RecommendationFilter,
  ): Promise<RecommendationRecord[]>;
  /**
   * Overwrites the mutable columns when the stored status still equals
   * `expected` (compare-and-set). Returns false when it changed meanwhile.
   */
  update(rec: RecommendationRecord, expected: RecStatus): Promise<boolean>;
  /** Draft/Proposed rows (all tenants) with expires_at ≤ now; system use. */
  listExpired(now: number, limit: number): Promise<RecommendationRecord[]>;
  /** Executed rows (all tenants) with executed_at ≤ before; system use. */
  listExecutedBefore(
    before: number,
    limit: number,
  ): Promise<RecommendationRecord[]>;
}

/** Stored scenario. */
export interface ScenarioRecord extends ScenarioDto {
  tenantId: string;
}

/** Scenario persistence. */
export interface ScenarioRepository {
  insert(s: ScenarioRecord): Promise<void>;
  get(tenantId: string, id: string): Promise<ScenarioRecord | null>;
  list(tenantId: string, limit: number): Promise<ScenarioRecord[]>;
  setResult(
    tenantId: string,
    id: string,
    result: ScenarioResult,
  ): Promise<void>;
  /** Replaces the stored perturbations (when a run supplies new ones). */
  setPerturbations(
    tenantId: string,
    id: string,
    perturbations: Perturbation[],
  ): Promise<void>;
}

/** LLM calls of a day. */
export interface LlmDayUsage {
  userCalls: number;
  tenantCalls: number;
}

/** LLM output cache and per-day usage accounting. */
export interface LlmStore {
  getCached(
    hash: string,
    notBefore: number,
  ): Promise<{output: string; model: string} | null>;
  putCached(
    hash: string,
    output: string,
    model: string,
    now: number,
  ): Promise<void>;
  purgeCache(before: number): Promise<number>;
  usage(day: string, tenantId: string, userId: string): Promise<LlmDayUsage>;
  recordUsage(
    day: string,
    tenantId: string,
    userId: string,
    model: string,
    calls: number,
    neurons: number,
  ): Promise<void>;
}
