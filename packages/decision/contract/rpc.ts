/**
 * @fileoverview RPC contract exposed by decision-engine (DecisionRpc).
 */

import type {CallCtx, Rid} from '@ontodecide/shared-kernel';
import type {
  CandidateAction,
  MappingSuggestion,
  Perturbation,
  RecStatus,
  RecommendationDto,
  ScenarioDto,
  ScenarioInput,
  ScenarioResult,
  TargetProp,
} from './types';

/** Decision engine RPC surface. */
export interface DecisionRpc {
  listScenarios(ctx: CallCtx): Promise<ScenarioDto[]>;
  createScenario(ctx: CallCtx, input: ScenarioInput): Promise<ScenarioDto>;
  getScenario(ctx: CallCtx, id: string): Promise<ScenarioDto>;
  /** Runs synchronously; persists the result when `scenarioId` is given. */
  runScenario(
    ctx: CallCtx,
    input: ScenarioInput & {scenarioId?: string},
  ): Promise<ScenarioResult>;
  /** Candidate actions for the objects impacted by the perturbations. */
  listCandidateActions(
    ctx: CallCtx,
    perturbations: Perturbation[],
  ): Promise<CandidateAction[]>;
  /** Queues generation (decision-jobs); returns the recommendation id as jobId. */
  generateRecommendation(
    ctx: CallCtx,
    req: {alertId?: string; scenarioId?: string; focus: Rid; locale?: string},
  ): Promise<{jobId: string}>;
  listRecommendations(
    ctx: CallCtx,
    filter?: {status?: RecStatus; focus?: Rid; limit?: number},
  ): Promise<RecommendationDto[]>;
  getRecommendation(ctx: CallCtx, id: string): Promise<RecommendationDto>;
  /** Approves and executes via object-graph applyAction with a signed voucher. */
  approve(ctx: CallCtx, id: string): Promise<RecommendationDto>;
  reject(ctx: CallCtx, id: string, reason: string): Promise<RecommendationDto>;
  feedback(
    ctx: CallCtx,
    id: string,
    input: {rating: number; comment?: string},
  ): Promise<RecommendationDto>;
  suggestMapping(
    ctx: CallCtx,
    sample: {
      fields: string[];
      rows: unknown[][];
      targetType: string;
      targetProps: TargetProp[];
    },
  ): Promise<MappingSuggestion>;
  /** Remaining LLM calls today for the caller. */
  llmQuota(
    ctx: CallCtx,
  ): Promise<{userRemaining: number; tenantRemaining: number}>;
  /** Daily: evaluate executed recommendations ≥ 24h old; expire stale ones. */
  evaluateOutcomes(now: string): Promise<{evaluated: number; expired: number}>;
}
