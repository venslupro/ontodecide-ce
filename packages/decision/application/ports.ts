/**
 * @fileoverview Ports of the decision application layer.
 */

import type {
  Clock,
  Logger,
  PageRequest,
  PageResult,
} from '@ontodecide/shared-kernel';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {SituationRpc} from '@ontodecide/situation/contract';
import type {RecStatus, ScenarioDto} from '../contract';
import type {RecRecord, TokenUsage} from '../domain';

/** Workspace-scoped scenario store (dec_scenario). */
export interface ScenarioRepository {
  insert(s: ScenarioDto): Promise<void>;
  get(id: string): Promise<ScenarioDto | null>;
}

/** Fields written when a decision is claimed. */
export interface DecisionClaim {
  status: 'Confirmed' | 'Rejected';
  key: string;
  decidedBy: 'owner' | 'admin';
  decidedAtMs: number;
  rejectReason?: string;
}

/** Workspace-scoped recommendation store (dec_recommendation). */
export interface RecommendationRepository {
  insert(rec: RecRecord): Promise<void>;
  get(id: string): Promise<RecRecord | null>;
  list(
    q: {status?: RecStatus},
    page: PageRequest,
  ): Promise<PageResult<RecRecord>>;
  /** Persists Proposed → Expired for due rows (all, or one id). */
  expireDue(nowMs: number, id?: string): Promise<number>;
  /**
   * Conditional UPDATE WHERE status = 'Proposed' AND expires_at > now AND
   * no decision key yet. False when nothing changed. A key already used by
   * another recommendation of the workspace is CONFLICT.
   */
  claimDecision(
    id: string,
    claim: DecisionClaim,
    nowMs: number,
  ): Promise<boolean>;
  /**
   * Starts an execution attempt (Confirmed with no attempt yet, or
   * ExecFailed below `maxAttempts`): status Confirmed, attempts + 1.
   */
  beginExecution(
    id: string,
    key: string,
    maxAttempts: number,
  ): Promise<boolean>;
  /** Records the outcome of the running attempt. */
  finishExecution(
    id: string,
    status: 'Executed' | 'ExecFailed',
    execution: RecRecord['execution'],
  ): Promise<void>;
}

/** Daily capped counters (dec_usage). */
export interface UsageCounter {
  tryTake(
    day: string,
    scope: string,
    key: UsageKey,
    n: number,
    cap: number,
  ): Promise<boolean>;
  adjust(
    day: string,
    scope: string,
    key: UsageKey,
    delta: number,
  ): Promise<void>;
  read(day: string, scope: string, key: UsageKey): Promise<number>;
}

/** Counter keys of dec_usage. */
export type UsageKey = 'rec_ai' | 'neurons';

/** One Workers AI call. */
export interface AiRequest {
  model: string;
  /** Primary: thinking off + JSON schema; fallback: reasoning effort low. */
  role: 'primary' | 'fallback';
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

/** A model reply: a parsed object (tool call / JSON mode) or text. */
export interface AiCompletion {
  output: unknown;
  usage?: TokenUsage;
}

/**
 * Anti-corruption layer over Workers AI (AiPort). Throws on timeout,
 * quota errors and model failures.
 */
export interface AiPort {
  complete(req: AiRequest): Promise<AiCompletion>;
}

/** Runtime configuration (vars). */
export interface DecisionConfig {
  aiModel: string;
  aiFallbackModel: string;
  recAiUserDailyLimit: number;
  neuronsDailyBudget: number;
  neuronsReserveFactor: number;
  recExpireHours: number;
  aiTimeoutMs: number;
}

/** Everything the use cases need. */
export interface DecisionDeps {
  scenarios(tid: string): ScenarioRepository;
  recommendations(tid: string): RecommendationRepository;
  usage: UsageCounter;
  /** Absent when Workers AI is not bound (local dev): rules only. */
  ai?: AiPort;
  objects: Pick<
    ObjectGraphRpc,
    'getObject' | 'listObjects' | 'getLinks' | 'impactSubgraph' | 'applyAction'
  >;
  ontology: Pick<OntologyRpc, 'getCompiledSchema'>;
  situation: Pick<SituationRpc, 'pushRecommendation'>;
  clock: Clock;
  logger: Logger;
  config: DecisionConfig;
}
