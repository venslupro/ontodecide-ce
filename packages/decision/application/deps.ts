/**
 * @fileoverview Dependencies shared by the decision use-case handlers.
 */

import type {Clock, Logger} from '@ontodecide/shared-kernel';
import type {
  CaseStore,
  GraphPort,
  JobQueue,
  LlmPort,
  LlmStore,
  ModelPort,
  Notifier,
  RecommendationRepository,
  ScenarioRepository,
} from './ports';

/** Tunables read from the environment. */
export interface DecisionConfig {
  /** Hours until a recommendation expires (≤ 72). */
  recExpireHours: number;
  userDailyLimit: number;
  tenantDailyLimit: number;
  /** HMAC secret shared with object-graph for approval vouchers. */
  approvalSecret: string;
  /** Voucher lifetime. */
  voucherTtlMs: number;
}

/** Everything the handlers need. */
export interface DecisionDeps {
  scenarios: ScenarioRepository;
  recommendations: RecommendationRepository;
  llmStore: LlmStore;
  /** Null when no provider is configured (rules only). */
  llm: LlmPort | null;
  cases: CaseStore;
  graph: GraphPort;
  models: ModelPort;
  notifier: Notifier;
  jobs: JobQueue;
  clock: Clock;
  logger: Logger;
  config: DecisionConfig;
}
