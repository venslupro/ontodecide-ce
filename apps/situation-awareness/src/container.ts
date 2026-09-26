/**
 * @fileoverview Composition root of situation-awareness.
 */

import {
  type Clock,
  type Logger,
  type QueueBatch,
  createLogger,
  systemClock,
} from '@ontodecide/shared-kernel';
import {
  type SituationDeps,
  type SituationRoomApi,
  USAGE_GUARD_NAME,
  type UsageGuardApi,
} from '@ontodecide/situation/application';
import type {SituationRpc} from '@ontodecide/situation/contract';
import {createD1Repositories} from '@ontodecide/situation/infrastructure';
import {
  createCronHandler,
  createFetchHandler,
  createQueueHandler,
  createSituationRpc,
} from '@ontodecide/situation/interface';
import type {Env} from './env';

/** Test / runtime overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
}

/** Assembled service parts. */
export interface Container {
  deps: SituationDeps;
  rpc: SituationRpc;
  queueHandler(batch: QueueBatch<unknown>): Promise<void>;
  cron(cron: string, now: Date): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

/** Wires repositories, Durable Object stubs, queues and handlers. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const clock = overrides.clock ?? systemClock;
  const logger =
    overrides.logger ?? createLogger({service: 'situation-awareness'});
  const roomStub = (tenantId: string) =>
    env.SITUATION_ROOM.get(env.SITUATION_ROOM.idFromName(tenantId));
  const deps: SituationDeps = {
    repos: createD1Repositories(env.SITUATION_DB),
    objects: env.OBJECTS,
    rooms: tenantId => roomStub(tenantId) as unknown as SituationRoomApi,
    usage: () =>
      env.USAGE_GUARD.get(
        env.USAGE_GUARD.idFromName(USAGE_GUARD_NAME),
      ) as unknown as UsageGuardApi,
    decisionJobs: env.DECISION_JOBS_QUEUE,
    replayTargets: {
      ingest: env.INGEST_QUEUE,
      'object-writes': env.OBJECT_WRITES_QUEUE,
      'graph-sync': env.GRAPH_SYNC_QUEUE,
      'situation-events': env.SITUATION_EVENTS_QUEUE,
      'decision-jobs': env.DECISION_JOBS_QUEUE,
    },
    clock,
    logger,
  };
  return {
    deps,
    rpc: createSituationRpc(deps),
    queueHandler: createQueueHandler(deps),
    cron: createCronHandler(deps),
    fetch: createFetchHandler((tenantId, request) =>
      roomStub(tenantId).fetch(request),
    ),
  };
}
