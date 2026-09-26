/**
 * @fileoverview Composition root of decision-engine.
 */

import {
  createLogger,
  MINUTE_MS,
  systemClock,
  type Clock,
  type Logger,
  type QueueBatch,
} from '@ontodecide/shared-kernel';
import type {DecisionRpc} from '@ontodecide/decision/contract';
import {DECISION_LIMITS} from '@ontodecide/decision/contract';
import type {
  CaseStore,
  DecisionConfig,
  DecisionDeps,
  Embedder,
  LlmPort,
} from '@ontodecide/decision/application';
import {
  buildLlmChain,
  D1CaseStore,
  D1LlmStore,
  D1RecommendationRepository,
  D1ScenarioRepository,
  VectorizeCaseStore,
  WorkersAiEmbedder,
  type AiRunner,
  type VectorIndexLike,
} from '@ontodecide/decision/infrastructure';
import {
  createDecisionCronHandler,
  createDecisionQueueHandler,
  createDecisionRpc,
  createHandlers,
  type DecisionHandlers,
} from '@ontodecide/decision/interface';
import type {Env} from './env';

/** Test and runtime overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  /** fetch used by the Gemini / Groq adapters. */
  fetch?: typeof fetch;
  /** Replaces the whole provider chain (cache and quotas still apply). */
  llm?: LlmPort;
  /** Replaces the bge-m3 embedder. */
  embedder?: Embedder;
}

/** Assembled service parts. */
export interface Container {
  deps: DecisionDeps;
  handlers: DecisionHandlers;
  rpc: DecisionRpc;
  queueHandler(batch: QueueBatch<unknown>): Promise<void>;
  cron(cron: string, now: Date): Promise<void>;
}

function intVar(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Parses tunables from the environment. */
export function readConfig(env: Env): DecisionConfig {
  return {
    recExpireHours: Math.min(
      Math.max(
        1,
        intVar(env.REC_EXPIRE_HOURS, DECISION_LIMITS.recExpireHoursDefault),
      ),
      DECISION_LIMITS.recExpireHoursMax,
    ),
    userDailyLimit: intVar(
      env.LLM_USER_DAILY_LIMIT,
      DECISION_LIMITS.userDailyLlmDefault,
    ),
    tenantDailyLimit: intVar(
      env.LLM_TENANT_DAILY_LIMIT,
      DECISION_LIMITS.tenantDailyLlmDefault,
    ),
    approvalSecret: env.APPROVAL_SECRET,
    voucherTtlMs: 10 * MINUTE_MS,
  };
}

/** Builds the container. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const clock = overrides.clock ?? systemClock;
  const logger = overrides.logger ?? createLogger({service: 'decision-engine'});
  const ai = env.AI as unknown as AiRunner | undefined;
  const llm =
    overrides.llm ??
    buildLlmChain({
      chain: env.LLM_CHAIN,
      ai,
      geminiApiKey: env.GEMINI_API_KEY,
      groqApiKey: env.GROQ_API_KEY,
      fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
      logger,
    });
  const embedder =
    overrides.embedder ?? (ai ? new WorkersAiEmbedder(ai) : null);
  const caseRows = new D1CaseStore(env.DECISION_DB, embedder);
  const cases: CaseStore =
    env.VEC && embedder
      ? new VectorizeCaseStore(
          env.VEC as unknown as VectorIndexLike,
          embedder,
          caseRows,
          logger,
        )
      : caseRows;
  if (!env.APPROVAL_SECRET) logger.warn('decision.approval_secret_missing');
  const deps: DecisionDeps = {
    scenarios: new D1ScenarioRepository(env.DECISION_DB),
    recommendations: new D1RecommendationRepository(env.DECISION_DB),
    llmStore: new D1LlmStore(env.DECISION_DB),
    llm,
    cases,
    graph: env.OBJECTS,
    models: env.ONTOLOGY,
    notifier: env.SITUATION,
    jobs: env.DECISION_JOBS_QUEUE,
    clock,
    logger,
    config: readConfig(env),
  };
  const handlers = createHandlers(deps);
  return {
    deps,
    handlers,
    rpc: createDecisionRpc(deps, handlers),
    queueHandler: createDecisionQueueHandler(handlers, logger),
    cron: createDecisionCronHandler(handlers, logger),
  };
}
