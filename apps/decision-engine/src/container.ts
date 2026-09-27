/**
 * @fileoverview Composition root of decision-engine.
 */

import {
  AI_MODELS,
  createLogger,
  systemClock,
  type Clock,
  type Logger,
  type TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import {DECISION_LIMITS, type DecisionRpc} from '@ontodecide/decision/contract';
import type {
  AiPort,
  DecisionConfig,
  DecisionDeps,
} from '@ontodecide/decision/application';
import {
  D1LifecycleRepository,
  D1RecommendationRepository,
  D1ScenarioRepository,
  D1UsageCounter,
  WorkersAiPort,
  type AiBinding,
} from '@ontodecide/decision/infrastructure';
import {
  createDecisionLifecycle,
  createDecisionRpc,
} from '@ontodecide/decision/interface';
import type {Env} from './env';

/** Test and dev overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  /** Replaces the Workers AI adapter; `null` disables AI (rules only). */
  ai?: AiPort | null;
}

function numVar(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

/** Reads the vars (defaults from the design). */
export function readConfig(env: Env): DecisionConfig {
  return {
    aiModel: env.AI_MODEL || AI_MODELS.primary,
    aiFallbackModel: env.AI_FALLBACK_MODEL || AI_MODELS.fallback,
    recAiUserDailyLimit: numVar(
      env.REC_AI_USER_DAILY_LIMIT,
      DECISION_LIMITS.aiRecsDaily,
    ),
    neuronsDailyBudget: numVar(
      env.NEURONS_DAILY_BUDGET,
      DECISION_LIMITS.neuronsDailyBudget,
    ),
    neuronsReserveFactor: numVar(
      env.NEURONS_RESERVE_FACTOR,
      DECISION_LIMITS.neuronsReserveFactor,
    ),
    recExpireHours: numVar(
      env.REC_EXPIRE_HOURS,
      DECISION_LIMITS.recExpireHours,
    ),
    aiTimeoutMs: DECISION_LIMITS.aiTimeoutMs,
  };
}

/** Wired service. */
export interface Container {
  deps: DecisionDeps;
  rpc: DecisionRpc;
  lifecycle: TenantLifecycleRpc;
}

/** Builds the container. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const clock = overrides.clock ?? systemClock;
  const logger =
    overrides.logger ??
    createLogger({service: 'decision-engine', env: env.ENVIRONMENT});
  const ai =
    overrides.ai === null
      ? undefined
      : (overrides.ai ??
        (env.AI
          ? new WorkersAiPort(env.AI as unknown as AiBinding)
          : undefined));
  const deps: DecisionDeps = {
    scenarios: tid => new D1ScenarioRepository(env.DECISION_DB, tid),
    recommendations: tid =>
      new D1RecommendationRepository(env.DECISION_DB, tid),
    usage: new D1UsageCounter(env.DECISION_DB),
    ...(ai ? {ai} : {}),
    objects: env.OBJECTS,
    ontology: env.ONTOLOGY,
    situation: env.SITUATION,
    clock,
    logger,
    config: readConfig(env),
  };
  return {
    deps,
    rpc: createDecisionRpc(deps),
    lifecycle: createDecisionLifecycle(
      new D1LifecycleRepository(env.DECISION_DB),
      clock,
    ),
  };
}
