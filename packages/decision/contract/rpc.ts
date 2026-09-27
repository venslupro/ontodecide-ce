/**
 * @fileoverview RPC contract of decision-engine (DecisionRpc entry point).
 * Depends on object-graph, situation-awareness and ontology-manager; uses
 * Workers AI directly (no AI Gateway, no external LLMs, no queue, no cron).
 */

import type {
  CallCtx,
  PageRequest,
  PageResult,
  QuotaItem,
} from '@ontodecide/shared-kernel';
import type {
  DecisionInput,
  GenerateInput,
  RecStatus,
  RecommendationDto,
  ScenarioDto,
  ScenarioInput,
} from './types';

/** decision-engine RPC surface. */
export interface DecisionRpc {
  /** Runs and stores a scenario (baseline / scenario / scenario + actions). */
  runScenario(ctx: CallCtx, input: ScenarioInput): Promise<ScenarioDto>;
  getScenario(ctx: CallCtx, id: string): Promise<ScenarioDto>;
  /** Proposed items past expires_at read (and persist) as Expired. */
  listRecommendations(
    ctx: CallCtx,
    q: {status?: RecStatus},
    page: PageRequest,
  ): Promise<PageResult<RecommendationDto>>;
  getRecommendation(ctx: CallCtx, id: string): Promise<RecommendationDto>;
  /**
   * Generates synchronously. rankedBy = rules when the user's 3 daily AI
   * rankings or the Neurons budget are used up, or both models fail.
   */
  generateRecommendation(
    ctx: CallCtx,
    input: GenerateInput,
  ): Promise<RecommendationDto>;
  /**
   * Confirms (then executes ranking[0] as svc:decision-engine) or rejects.
   * The same idempotency key returns the stored result; a state that does
   * not allow the decision is CONFLICT.
   */
  decide(
    ctx: CallCtx,
    id: string,
    input: DecisionInput,
    idempotencyKey: string,
  ): Promise<RecommendationDto>;
  /** aiRecsToday of the caller. */
  usage(ctx: CallCtx): Promise<QuotaItem[]>;
}
