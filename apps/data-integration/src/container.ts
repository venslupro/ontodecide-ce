/**
 * @fileoverview Composition root of data-integration.
 */

import {
  AI_MODELS,
  CE_LIMITS,
  createLogger,
  systemClock,
  ulid,
} from '@ontodecide/shared-kernel';
import type {
  Clock,
  Logger,
  TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import type {IntegrationRpc} from '@ontodecide/integration/contract';
import type {
  AiPort,
  IntegrationConfig,
  IntegrationDeps,
} from '@ontodecide/integration/application';
import {
  D1JobRepository,
  D1UsageRepository,
  WorkersAiPort,
} from '@ontodecide/integration/infrastructure';
import {
  createIntegrationLifecycle,
  createIntegrationRpc,
} from '@ontodecide/integration/interface';
import type {Env} from './env';

/** Test and harness overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  /** Replaces the Workers AI adapter (null forces rules only). */
  ai?: AiPort | null;
  newId?: (nowMs: number) => string;
}

/** Wired service parts. */
export interface Container {
  rpc: IntegrationRpc;
  lifecycle: TenantLifecycleRpc;
  deps: IntegrationDeps;
}

function intVar(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0
    ? Math.floor(n)
    : fallback;
}

/** Reads limits and budgets from the Worker vars. */
export function configFrom(env: Env): IntegrationConfig {
  return {
    importRowsDaily: intVar(env.IMPORT_ROWS_DAILY, CE_LIMITS.importRowsDaily),
    seedRowsDaily: intVar(env.SEED_ROWS_DAILY, 20_000),
    mappingAiDaily: intVar(env.MAPPING_AI_DAILY, CE_LIMITS.mappingDraftsDaily),
    neuronsDailyBudget: intVar(env.NEURONS_DAILY_BUDGET, 1500),
    draftNeurons: 19,
    reserveFactor: 1.3,
    maxObjects: CE_LIMITS.objects,
    maxLinks: CE_LIMITS.links,
  };
}

/** Creates the container. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const clock = overrides.clock ?? systemClock;
  const logger =
    overrides.logger ?? createLogger({service: 'data-integration'});
  const ai =
    overrides.ai !== undefined
      ? overrides.ai
      : env.AI
        ? new WorkersAiPort(env.AI, env.AI_MODEL || AI_MODELS.primary)
        : null;
  const db = env.INTEGRATION_DB;
  const deps: IntegrationDeps = {
    jobs: ctx => new D1JobRepository(db, ctx.tid),
    usage: new D1UsageRepository(db),
    ontology: env.ONTOLOGY,
    objects: env.OBJECTS,
    ai,
    clock,
    logger,
    config: configFrom(env),
    newId: overrides.newId ?? (nowMs => ulid(nowMs)),
  };
  return {
    rpc: createIntegrationRpc(deps),
    lifecycle: createIntegrationLifecycle(db, clock),
    deps,
  };
}
